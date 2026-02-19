/**
 * ExecutionModelClient (EMC) — browser-safe subset of execution model operations.
 *
 * This module runs in the browser, CONCURRENT with the backend
 * ExecutionModelManager (EMM in packages/agent/src/execution-model.ts).
 *
 * CONCURRENCY SAFETY:
 * All methods operate on QUIESCENT state only — state that no automated
 * backend process (scheduler, reconciliation, crash recovery) is actively
 * reading or writing. Specifically:
 *   - Mutation resolution methods require mutation.status = "indeterminate",
 *     which means reconciliation has given up and the scheduler is blocked
 *     by workflow.error. No backend process touches these rows.
 *   - Workflow lifecycle methods only write workflow.status (user-controlled,
 *     never written by EMM) and workflow.error (only written by EMM during
 *     active handler execution, which can't be happening when the user is
 *     interacting with the workflow).
 *
 * SYNC SAFETY:
 * cr-sqlite syncs rows independently. Multi-table transactions may arrive
 * at the backend as separate row updates over multiple sync ticks. All
 * methods are designed so that partial sync causes delays but never
 * invariant violations. See specs/new/emm-emc-split.md for full analysis.
 *
 * NEVER add methods here that operate on active execution state (handler
 * runs in progress, in-flight mutations, etc.). Those belong in EMM only.
 *
 * @see packages/agent/src/execution-model.ts — EMM (backend counterpart)
 * @see specs/new/emm-emc-split.md — design doc with concurrency analysis
 */

import { KeepDbApi } from "@app/db";

export class ExecutionModelClient {
  constructor(private api: KeepDbApi) {}

  // ==========================================================================
  // Mutation resolution
  //
  // These mirror EMM.failMutation / EMM.skipMutation but with a stricter
  // precondition: mutation must be "indeterminate" (quiescent state).
  // ==========================================================================

  /**
   * Resolve an indeterminate mutation as "did not happen".
   *
   * Mirrors: EMM.failMutation() — atomically sets mutation=failed,
   * mutation_outcome=failure, advances phase to mutated, releases events,
   * clears pending_retry and workflow.error.
   *
   * After sync: released events become pending → scheduler (unblocked by
   * error clearing) starts fresh session to reprocess them.
   *
   * @param mutationId - The indeterminate mutation to resolve
   */
  async resolveMutationFailed(mutationId: string): Promise<void> {
    const mutation = await this.api.mutationStore.get(mutationId);
    if (!mutation) throw new Error(`Mutation not found: ${mutationId}`);
    if (mutation.status !== "indeterminate") {
      throw new Error(
        `resolveMutationFailed: mutation ${mutationId} is not indeterminate ` +
          `(status=${mutation.status}). Only indeterminate mutations can be ` +
          `resolved from the browser.`,
      );
    }

    const run = await this.api.handlerRunStore.get(mutation.handler_run_id);
    if (!run) throw new Error(`Handler run not found: ${mutation.handler_run_id}`);

    const now = Date.now();

    await this.api.db.db.tx(async (tx: any) => {
      // Mutation → failed
      await this.api.mutationStore.update(
        mutationId,
        {
          status: "failed",
          resolved_by: "user_assert_failed",
          resolved_at: now,
        },
        tx,
      );

      // Handler run: set mutation_outcome + advance phase (EMM invariant)
      await this.api.handlerRunStore.update(
        run.id,
        {
          mutation_outcome: "failure",
          phase: "mutated",
        } as any,
        tx,
      );

      // Release events — mutation didn't happen, events can be reprocessed
      await this.api.eventStore.releaseEvents(run.id, tx);

      // Clear pending_retry + workflow.error (mutation resolved)
      await this.api.scriptStore.updateWorkflowFields(
        run.workflow_id,
        {
          pending_retry_run_id: "",
          error: "",
        },
        tx,
      );
    });
  }

  /**
   * Resolve an indeterminate mutation as "skip".
   *
   * Mirrors: EMM.skipMutation() — atomically sets mutation=failed (user_skip),
   * mutation_outcome=skipped, advances phase to mutated, skips events,
   * sets pending_retry for next() execution, clears workflow.error.
   *
   * After sync: scheduler sees pending_retry_run_id + no error → creates
   * retry run at emitting phase → executes next() with skipped result.
   *
   * @param mutationId - The indeterminate mutation to resolve
   */
  async resolveMutationSkipped(mutationId: string): Promise<void> {
    const mutation = await this.api.mutationStore.get(mutationId);
    if (!mutation) throw new Error(`Mutation not found: ${mutationId}`);
    if (mutation.status !== "indeterminate") {
      throw new Error(
        `resolveMutationSkipped: mutation ${mutationId} is not indeterminate ` +
          `(status=${mutation.status}). Only indeterminate mutations can be ` +
          `resolved from the browser.`,
      );
    }

    const run = await this.api.handlerRunStore.get(mutation.handler_run_id);
    if (!run) throw new Error(`Handler run not found: ${mutation.handler_run_id}`);

    const now = Date.now();

    await this.api.db.db.tx(async (tx: any) => {
      // Mutation → failed (skipped)
      await this.api.mutationStore.update(
        mutationId,
        {
          status: "failed",
          resolved_by: "user_skip",
          resolved_at: now,
        },
        tx,
      );

      // Handler run: set mutation_outcome + advance phase (EMM invariant)
      await this.api.handlerRunStore.update(
        run.id,
        {
          mutation_outcome: "skipped",
          phase: "mutated",
        } as any,
        tx,
      );

      // Skip events — mark as terminal
      await this.api.eventStore.skipEvents(run.id, tx);

      // Set pending_retry (for next() via retry) + clear error
      await this.api.scriptStore.updateWorkflowFields(
        run.workflow_id,
        {
          pending_retry_run_id: run.id,
          error: "",
        },
        tx,
      );
    });
  }

  // ==========================================================================
  // Workflow lifecycle
  //
  // User-controlled status transitions. EMM never writes workflow.status,
  // so these are race-free by design.
  // ==========================================================================

  /**
   * Pause a workflow — user-initiated.
   *
   * Mirrors: EMM.pauseWorkflow(). Sets workflow.status = "paused".
   * Does NOT touch handler runs, events, mutations, or workflow.error.
   *
   * If a session is currently running, it completes normally — pause only
   * prevents the scheduler from starting NEW sessions.
   */
  async pauseWorkflow(workflowId: string): Promise<void> {
    await this.api.scriptStore.updateWorkflowFields(workflowId, {
      status: "paused",
    });
  }

  /**
   * Resume a workflow — user-initiated.
   *
   * Mirrors: EMM.resumeWorkflow(), extended with error clearing.
   * Sets workflow.status = "active" and clears workflow.error.
   *
   * Why clear error: the user clicking "Resume" signals they've addressed
   * the issue (reconnected auth, accepted state, etc.). If the underlying
   * issue persists, the scheduler will re-encounter it and set the error
   * again on the next failed run.
   */
  async resumeWorkflow(workflowId: string): Promise<void> {
    await this.api.scriptStore.updateWorkflowFields(workflowId, {
      status: "active",
      error: "",
    });
  }

  /**
   * Archive a workflow — user-initiated.
   *
   * Sets workflow.status = "archived". Stops all scheduling permanently
   * until the user explicitly unarchives.
   */
  async archiveWorkflow(workflowId: string): Promise<void> {
    await this.api.scriptStore.updateWorkflowFields(workflowId, {
      status: "archived",
    });
  }

  /**
   * Unarchive a workflow — user-initiated.
   *
   * Restores to a safe non-running state: "paused" if the workflow has an
   * active script, "draft" if not. Never restores directly to "active" —
   * user must explicitly resume after unarchiving.
   *
   * @param workflowId - Workflow to unarchive
   * @param hasActiveScript - Whether the workflow has an active_script_id
   */
  async unarchiveWorkflow(
    workflowId: string,
    hasActiveScript: boolean,
  ): Promise<void> {
    await this.api.scriptStore.updateWorkflowFields(workflowId, {
      status: hasActiveScript ? "paused" : "draft",
    });
  }
}
