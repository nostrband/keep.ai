/**
 * ExecutionModelManager — single source of truth for all execution state transitions.
 *
 * Per the exec-state-consolidation spec, this module owns ALL transitions of the
 * abstract execution model's controlled variables:
 *   - Handler run status (active → paused:* / failed:* / committed / crashed)
 *   - Handler run phase (preparing → prepared → mutating → mutated → emitting → committed)
 *   - Event status (pending → reserved → consumed / skipped)
 *   - Mutation outcome on handler runs (mutation_outcome field)
 *   - Script run (session) finalization
 *
 * No other code may directly modify these fields. This ensures:
 *   1. All related state changes happen in a single transaction (no crash windows)
 *   2. The mutation boundary invariant is always respected
 *   3. Event disposition is always correct (release pre-mutation, preserve post-mutation)
 *
 * Key design principles:
 *   - Phase only moves forward (preparing → ... → committed). Failures change status, not phase.
 *   - The mutation boundary divides pre/post-mutation behavior:
 *     Pre-mutation (mutation_outcome = "" or "failure"): events released, fresh retry
 *     Post-mutation (mutation_outcome = "success" or "skipped"): events preserved, retry from emitting
 *   - Mutation methods (apply/fail) are about the mutation phase — they NEVER touch run status.
 *     Run status is handled by updateHandlerRunStatus, which is orthogonal.
 *     Skip is UI-only and lives in ExecutionModelClient (browser package).
 *   - workflow.status is user-controlled (managed by ExecutionModelClient, never by this module)
 *   - workflow.error is system-controlled (set/cleared by this module)
 *
 * References:
 *   - docs/dev/06-execution-model.md (abstract model)
 *   - docs/dev/06b-consumer-lifecycle.md (consumer phases)
 *   - docs/dev/09-failure-repair.md (failure handling)
 *   - docs/dev/16-scheduling.md (scheduling)
 *   - specs/new/exec-state-consolidation.md (this module's spec)
 */

import {
  KeepDbApi,
  HandlerRun,
  HandlerRunPhase,
  RunStatus,
  Mutation,
  MutationStatus,
  MutationResolution,
  EventReservation,
  DBInterface,
} from "@app/db";

import debug from "debug";

const log = debug("agent:execution-model");

// ============================================================================
// Types
// ============================================================================

/**
 * Options for updateHandlerRunStatus.
 */
export interface UpdateHandlerRunStatusOpts {
  /** Error message describing what went wrong */
  error?: string;
  /** Classified error type (auth, permission, network, logic, unknown) */
  errorType?: string;
  /** End timestamp (defaults to now if not provided) */
  endTimestamp?: string;
}

/**
 * Options for updateConsumerPhase when transitioning to "prepared".
 * Required only for the preparing → prepared transition.
 */
export interface PreparedPhaseOpts {
  /** Event reservations from prepare result */
  reservations: EventReservation[];
  /** Serialized prepare result JSON (includes reservations, data, ui) */
  prepareResult: string;
  /** Optional wake time for time-based scheduling (milliseconds) */
  wakeAt?: number;
}

/**
 * Options for commitConsumer.
 */
export interface CommitConsumerOpts {
  /** Handler persistent state to save (from next() return value). If undefined, state is not updated. */
  state?: unknown;
  /** Serialized state JSON for handler_run.output_state */
  outputState?: string;
}

/**
 * Options for commitProducer.
 */
export interface CommitProducerOpts {
  /** Handler persistent state to save. If undefined, state is not updated. */
  state?: unknown;
  /** Serialized state JSON for handler_run.output_state */
  outputState?: string;
  /** Next run time for the producer schedule (milliseconds since epoch) */
  nextRunAt?: number;
}

/**
 * Options for applyMutation.
 */
export interface ApplyMutationOpts {
  /** Serialized mutation result JSON */
  result?: string;
  /** How the mutation was resolved (e.g. "reconciliation") */
  resolvedBy?: MutationResolution | "";
  /** When the mutation was resolved (milliseconds since epoch) */
  resolvedAt?: number;
}

/**
 * Options for failMutation.
 */
export interface FailMutationOpts {
  /** Error message */
  error?: string;
  /** How the mutation was resolved (e.g. "user_assert_failed") */
  resolvedBy?: MutationResolution | "";
  /** When the mutation was resolved (milliseconds since epoch) */
  resolvedAt?: number;
}

/**
 * Options for updateMutationStatus.
 */
export interface UpdateMutationStatusOpts {
  /** Error message */
  error?: string;
  /** Tool namespace */
  toolNamespace?: string;
  /** Tool method */
  toolMethod?: string;
  /** Serialized tool params JSON */
  params?: string;
  /** Idempotency key */
  idempotencyKey?: string;
  /** Next reconciliation time (milliseconds since epoch) */
  nextReconcileAt?: number;
}

// ============================================================================
// Phase ordering for validation
// ============================================================================

/**
 * Numeric ordering of consumer phases for validation.
 * Higher number = later in the state machine.
 *
 * Producer phases: pending(0) → executing → committed
 * Consumer phases: pending(0) → preparing(1) → prepared(2) → mutating(3) → mutated(4) → emitting(5) → committed(6)
 */
const CONSUMER_PHASE_ORDER: Record<string, number> = {
  pending: 0,
  preparing: 1,
  prepared: 2,
  mutating: 3,
  mutated: 4,
  emitting: 5,
  committed: 6,
};

const PRODUCER_PHASE_ORDER: Record<string, number> = {
  pending: 0,
  executing: 1,
  committed: 2,
};

// ============================================================================
// ExecutionModelManager
// ============================================================================

export class ExecutionModelManager {
  private api: KeepDbApi;

  /** Shorthand for the execution-model store facade. */
  private get store() {
    return this.api.executionModelStore;
  }

  constructor(api: KeepDbApi) {
    this.api = api;
  }

  // ==========================================================================
  // Method 1: updateHandlerRunStatus
  // ==========================================================================

  /**
   * Update a handler run's status (failure, pause, crash, or commit).
   *
   * This is the ONLY way to change a handler run's status field. It atomically
   * handles all side effects based on the pre/post-mutation boundary:
   *
   * For non-committed statuses (failure/paused/crashed):
   *   - Pre-mutation (phase < mutated, or mutation_outcome = "failure"):
   *     → releases reserved events back to pending
   *   - Post-mutation (mutation_outcome = "success" or "skipped"):
   *     → sets pending_retry_run_id (events stay reserved for retry)
   *   - Indeterminate (phase = mutating, mutation in-flight):
   *     → sets pending_retry_run_id + workflow.error
   *
   * Also atomically handles:
   *   - Session (script_run) finalization on failure/paused/crashed
   *   - Maintenance flag on failed:logic
   *   - workflow.error on statuses needing user attention
   *
   * Never touches workflow.status (user-controlled) or handler run phase.
   *
   * @param runId - Handler run ID
   * @param newStatus - Target status
   * @param opts - Additional options (error message, error type, timestamp)
   * @param tx - Optional transaction context (for internal callers like commitConsumer)
   */
  async updateHandlerRunStatus(
    runId: string,
    newStatus: RunStatus,
    opts?: UpdateHandlerRunStatusOpts,
    tx?: DBInterface,
  ): Promise<void> {
    const runTx = async (tx: DBInterface) => {
      const run = await this.store.getHandlerRun(runId, tx);
      if (!run) throw new Error(`Handler run not found: ${runId}`);

      const endTimestamp = opts?.endTimestamp || new Date().toISOString();

      // 1. Update handler_run: status, error, end_timestamp
      //    Phase is NEVER changed here — phase only moves forward via updateConsumerPhase.
      await this.store.updateHandlerRun(
        runId,
        {
          status: newStatus,
          error: opts?.error || "",
          error_type: (opts?.errorType as any) || "",
          end_timestamp: endTimestamp,
        },
        tx,
      );

      // 2. Consumer event disposition (only for non-committed statuses)
      //    Producers don't reserve events, so this is a no-op for them.
      if (newStatus !== "committed" && run.handler_type === "consumer") {
        await this._handleEventDisposition(run, tx);
      }

      // 3. Session finalization (only on failure/paused/crashed — NOT on committed)
      //    Committed runs don't end the session — the scheduler may run more handlers.
      if (newStatus !== "committed") {
        await this._finalizeSession(run, opts?.error || "", tx);
      }

      // 4. Maintenance flag (only for failed:logic)
      //    Atomic with the rest — no crash window between failure and maintenance flag.
      if (newStatus === "failed:logic") {
        await this.store.updateWorkflowFields(
          run.workflow_id,
          { maintenance: true },
          tx,
        );
      }

      // 5. Workflow error (only on statuses that need user attention)
      //    Never touches workflow.status — that is user-controlled.
      const workflowError = this._getWorkflowErrorForStatus(
        newStatus,
        opts?.error,
      );
      if (workflowError !== null) {
        await this.store.updateWorkflowFields(
          run.workflow_id,
          { error: workflowError },
          tx,
        );
      }
    };

    if (tx) {
      await runTx(tx);
    } else {
      await this.api.db.db.tx(runTx);
    }
  }

  // ==========================================================================
  // Method 2: updateConsumerPhase
  // ==========================================================================

  /**
   * Advance a consumer handler run to the next phase.
   *
   * This is the single source of truth for ALL non-terminal phase transitions.
   * Even when called internally by applyMutation/failMutation/skipMutation,
   * the phase update goes through this method.
   *
   * Phase-specific side effects:
   *   - preparing → prepared: reserves events, saves prepare_result, saves wakeAt
   *   - prepared → mutating: guard that reservations are non-empty
   *   - prepared → emitting: allowed (empty reservations or no mutate)
   *   - mutating → mutated: pure phase update (mutation outcome already set by caller)
   *   - mutated → emitting: guard that mutation_outcome != "failure"
   *
   * Throws if:
   *   - newPhase is "committed" (use commitConsumer instead)
   *   - Phase ordering is violated (new phase must be strictly later)
   *   - Guard conditions fail (e.g. mutated→emitting with failed mutation)
   *
   * May be called on non-active runs (e.g. paused:reconciliation) when
   * mutation outcome is resolved — phase is about execution progress, not run health.
   *
   * @param runId - Handler run ID
   * @param newPhase - Target phase
   * @param opts - Phase-specific options (required for preparing→prepared)
   * @param tx - Optional transaction context (for internal callers)
   */
  async updateConsumerPhase(
    runId: string,
    newPhase: HandlerRunPhase,
    opts?: PreparedPhaseOpts,
    tx?: DBInterface,
  ): Promise<void> {
    // committed is NOT a valid target — must use commitConsumer()
    if (newPhase === "committed") {
      throw new Error(
        "Cannot advance to 'committed' via updateConsumerPhase. Use commitConsumer() instead.",
      );
    }

    const runTx = async (tx: DBInterface) => {
      const run = await this.store.getHandlerRun(runId, tx);
      if (!run) throw new Error(`Handler run not found: ${runId}`);

      // Validate phase ordering — new phase must be strictly later
      const currentOrder = CONSUMER_PHASE_ORDER[run.phase];
      const newOrder = CONSUMER_PHASE_ORDER[newPhase];
      if (currentOrder === undefined || newOrder === undefined) {
        throw new Error(
          `Invalid phase transition: ${run.phase} → ${newPhase}`,
        );
      }
      if (newOrder <= currentOrder) {
        throw new Error(
          `Phase must advance forward: ${run.phase} (${currentOrder}) → ${newPhase} (${newOrder})`,
        );
      }

      // Phase-specific logic
      switch (`${run.phase} → ${newPhase}`) {
        case "pending → preparing":
          // Simple phase update
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;

        case "preparing → prepared": {
          // Atomic: phase + reserve events + save prepare_result + wakeAt
          if (!opts) {
            throw new Error(
              "PreparedPhaseOpts required for preparing → prepared transition",
            );
          }

          await this.store.updateHandlerRun(
            runId,
            {
              phase: newPhase,
              prepare_result: opts.prepareResult,
            },
            tx,
          );

          // Reserve events (may be empty reservations — that's fine)
          if (opts.reservations.length > 0) {
            await this.store.reserveEvents(
              runId,
              opts.reservations,
              tx,
            );
          }

          // Save wakeAt to handler state if provided (for time-based scheduling)
          if (opts.wakeAt !== undefined) {
            await this.store.updateHandlerWakeAt(
              run.workflow_id,
              run.handler_name,
              opts.wakeAt,
              tx,
            );
          }
          break;
        }

        case "prepared → mutating": {
          // Guard: reservations must be non-empty (no mutation without events)
          const prepareResult = run.prepare_result
            ? JSON.parse(run.prepare_result)
            : null;
          const reservations = prepareResult?.reservations || [];
          const hasEvents = reservations.some(
            (r: EventReservation) => r.ids && r.ids.length > 0,
          );
          if (!hasEvents) {
            throw new Error(
              "Cannot transition to mutating with empty reservations. " +
                "Use prepared → emitting for empty reservation case.",
            );
          }
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;
        }

        case "prepared → emitting":
          // Empty reservations or no mutate — skip mutation phase.
          // mutation_outcome stays "" which is treated as pre-mutation by
          // updateHandlerRunStatus, so failures release events correctly.
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;

        case "mutating → mutated":
          // "Mutate phase complete, tool outcome known" — set for ALL terminal
          // mutation outcomes (applied, failed, skipped), not just "applied".
          // May be called on non-active runs (reconciliation resolved the outcome).
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;

        case "mutated → emitting": {
          // Guard: mutation_outcome must not be "failure"
          // (failed mutations release events and can't proceed to emitting)
          if (run.mutation_outcome === "failure") {
            throw new Error(
              "Cannot transition mutated → emitting when mutation_outcome = 'failure'. " +
                "Failed mutations release events; the run cannot proceed.",
            );
          }
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;
        }

        default:
          // Allow any forward phase transition not explicitly handled above
          // (e.g. pending → prepared for recovery scenarios)
          await this.store.updateHandlerRunPhase(runId, newPhase, tx);
          break;
      }
    };

    if (tx) {
      await runTx(tx);
    } else {
      await this.api.db.db.tx(runTx);
    }
  }

  // ==========================================================================
  // Method 2b: updateProducerPhase
  // ==========================================================================

  /**
   * Advance a producer handler run's phase forward.
   *
   * Validates forward-only ordering: pending → executing → committed.
   * "committed" is blocked — must use commitProducer() instead.
   *
   * @param runId - Handler run ID
   * @param newPhase - Target phase
   */
  async updateProducerPhase(
    runId: string,
    newPhase: HandlerRunPhase,
  ): Promise<void> {
    if (newPhase === "committed") {
      throw new Error(
        "Cannot advance to 'committed' via updateProducerPhase. Use commitProducer() instead.",
      );
    }

    await this.api.db.db.tx(async (tx) => {
      const run = await this.store.getHandlerRun(runId, tx);
      if (!run) throw new Error(`Handler run not found: ${runId}`);

      if (run.handler_type !== "producer") {
        throw new Error(
          `updateProducerPhase called on ${run.handler_type} run. Use updateConsumerPhase instead.`,
        );
      }

      const currentOrder = PRODUCER_PHASE_ORDER[run.phase];
      const newOrder = PRODUCER_PHASE_ORDER[newPhase];
      if (currentOrder === undefined || newOrder === undefined) {
        throw new Error(
          `Invalid producer phase transition: ${run.phase} → ${newPhase}`,
        );
      }
      if (newOrder <= currentOrder) {
        throw new Error(
          `Producer phase must advance forward: ${run.phase} (${currentOrder}) → ${newPhase} (${newOrder})`,
        );
      }

      await this.store.updateHandlerRunPhase(runId, newPhase, tx);
    });
  }

  // ==========================================================================
  // Method 3: commitConsumer
  // ==========================================================================

  /**
   * Commit a consumer handler run — the terminal success transition.
   *
   * Atomically: consume events, save handler state, advance to committed,
   * and increment session handler count.
   *
   * This is the ONLY way to reach phase="committed" for consumers.
   * updateConsumerPhase throws if you try to pass "committed".
   *
   * @param runId - Handler run ID
   * @param opts - Commit options (handler state to persist)
   */
  async commitConsumer(
    runId: string,
    opts?: CommitConsumerOpts,
  ): Promise<void> {
    await this.api.db.db.tx(async (tx) => {
      const run = await this.store.getHandlerRun(runId, tx);
      if (!run) throw new Error(`Handler run not found: ${runId}`);

      if (run.handler_type !== "consumer") {
        throw new Error(
          `commitConsumer called on ${run.handler_type} run. Use commitProducer instead.`,
        );
      }

      // Guard: double commit is a bug — caller must not commit the same run twice
      if (run.status === "committed") {
        throw new Error(`commitConsumer: run ${runId} is already committed`);
      }

      // Consume events reserved by this run (pending → consumed)
      await this.store.consumeEvents(runId, tx);

      // Save handler persistent state if provided
      if (opts?.state !== undefined) {
        await this.store.setHandlerState(
          run.workflow_id,
          run.handler_name,
          opts.state,
          runId,
          tx,
        );
      }

      // Update handler_run: phase, output_state
      await this.store.updateHandlerRun(
        runId,
        {
          phase: "committed",
          output_state: opts?.outputState || "",
        },
        tx,
      );

      // Set status to committed via updateHandlerRunStatus logic
      // (handles the committed path: no event disposition, no session finalization)
      await this.updateHandlerRunStatus(runId, "committed", {}, tx);

      // Increment session handler_run_count
      await this.store.incrementHandlerCount(run.script_run_id, tx);
    });
  }

  // ==========================================================================
  // Method 4: commitProducer
  // ==========================================================================

  /**
   * Commit a producer handler run — the terminal success transition.
   *
   * Atomically: save handler state, advance to committed, update producer
   * schedule, and increment session handler count.
   *
   * Producers don't reserve/consume events or have mutations.
   *
   * @param runId - Handler run ID
   * @param opts - Commit options (handler state, schedule update)
   */
  async commitProducer(
    runId: string,
    opts?: CommitProducerOpts,
  ): Promise<void> {
    await this.api.db.db.tx(async (tx) => {
      const run = await this.store.getHandlerRun(runId, tx);
      if (!run) throw new Error(`Handler run not found: ${runId}`);

      if (run.handler_type !== "producer") {
        throw new Error(
          `commitProducer called on ${run.handler_type} run. Use commitConsumer instead.`,
        );
      }

      // Guard: double commit is a bug — caller must not commit the same run twice
      if (run.status === "committed") {
        throw new Error(`commitProducer: run ${runId} is already committed`);
      }

      // Save handler persistent state if provided
      if (opts?.state !== undefined) {
        await this.store.setHandlerState(
          run.workflow_id,
          run.handler_name,
          opts.state,
          runId,
          tx,
        );
      }

      // Update handler_run: phase, output_state
      await this.store.updateHandlerRun(
        runId,
        {
          phase: "committed",
          output_state: opts?.outputState || "",
        },
        tx,
      );

      // Set status to committed
      await this.updateHandlerRunStatus(runId, "committed", {}, tx);

      // Update producer schedule (next_run_at)
      if (opts?.nextRunAt !== undefined) {
        await this.store.updateProducerScheduleAfterRun(
          run.workflow_id,
          run.handler_name,
          opts.nextRunAt,
          tx,
        );
      }

      // Increment session handler_run_count
      await this.store.incrementHandlerCount(run.script_run_id, tx);
    });
  }

  // ==========================================================================
  // Method 5: applyMutation
  // ==========================================================================

  /**
   * Mark a mutation as successfully applied.
   *
   * Atomically: set mutation status, set mutation_outcome on handler run,
   * advance phase to "mutated", and clear workflow.error.
   *
   * Does NOT touch handler run status — that's orthogonal.
   * After this returns, the handler state machine continues: mutated → emitting → next().
   *
   * Called by:
   *   - Tool wrapper on successful mutation execution
   *   - Reconciliation scheduler on confirmed success
   *   - User UI: "assert applied" click
   *
   * @param mutationId - Mutation record ID
   * @param opts - Options (mutation result)
   */
  async applyMutation(
    mutationId: string,
    opts?: ApplyMutationOpts,
  ): Promise<void> {
    await this.api.db.db.tx(async (tx) => {
      const mutation = await this.store.getMutation(mutationId, tx);
      if (!mutation) throw new Error(`Mutation not found: ${mutationId}`);

      // Input validation: reject already-terminal mutations
      this._assertMutationNotTerminal(mutation, "applyMutation");

      // Update mutation record
      const mutationUpdate: any = {
        status: "applied",
        result: opts?.result || "",
      };
      if (opts?.resolvedBy) mutationUpdate.resolved_by = opts.resolvedBy;
      if (opts?.resolvedAt !== undefined) mutationUpdate.resolved_at = opts.resolvedAt;
      else if (opts?.resolvedBy) mutationUpdate.resolved_at = Date.now();
      await this.store.updateMutation(mutationId, mutationUpdate, tx);

      // Set mutation_outcome on handler run
      await this.store.updateHandlerRun(
        mutation.handler_run_id,
        { mutation_outcome: "success" },
        tx,
      );

      // Advance phase to "mutated" via updateConsumerPhase (single source of truth)
      await this.updateConsumerPhase(
        mutation.handler_run_id,
        "mutated",
        undefined,
        tx,
      );

      // Clear workflow.error (mutation resolved, no longer needs attention).
      // For reconciliation: pending_retry_run_id was already set when the run
      // entered paused:reconciliation — clearing error unblocks the scheduler
      // to process the existing pending retry.
      await this.store.updateWorkflowFields(
        mutation.workflow_id,
        { error: "" },
        tx,
      );
    });
  }

  // ==========================================================================
  // Method 6: failMutation
  // ==========================================================================

  /**
   * Mark a mutation as definitively failed.
   *
   * Atomically: set mutation status, set mutation_outcome, advance phase to
   * "mutated", release events, clear pending_retry, clear workflow.error.
   *
   * Does NOT touch handler run status — that's orthogonal. The caller (tool
   * wrapper or handler state machine) handles run status separately via
   * updateHandlerRunStatus if the run is still active.
   *
   * For already-terminal runs (reconciliation/user resolution), no handler
   * status change is needed.
   *
   * Crash window (active run): If crash between failMutation TX and
   * updateHandlerRunStatus, the run is active + phase=mutated + mutation_outcome="failure".
   * recoverCrashedRuns() handles this: mutation_outcome="failure" → pre-mutation path →
   * releaseEvents (no-op) → marks crashed.
   *
   * Called by:
   *   - Tool wrapper on definite failure (caller handles status separately)
   *   - Reconciliation scheduler on confirmed failure
   *   - User UI: "didn't happen" click
   *
   * @param mutationId - Mutation record ID
   * @param opts - Options (error, resolved_by for user/reconciliation resolution)
   */
  async failMutation(
    mutationId: string,
    opts?: FailMutationOpts,
  ): Promise<void> {
    await this.api.db.db.tx(async (tx) => {
      const mutation = await this.store.getMutation(mutationId, tx);
      if (!mutation) throw new Error(`Mutation not found: ${mutationId}`);

      // Input validation: reject already-terminal mutations (except indeterminate,
      // which is terminal for reconciliation but resolvable by user)
      this._assertMutationNotTerminal(mutation, "failMutation");

      // Update mutation record
      await this.store.updateMutation(
        mutationId,
        {
          status: "failed",
          error: opts?.error || "",
          resolved_by: opts?.resolvedBy || "",
          resolved_at: opts?.resolvedAt || (opts?.resolvedBy ? Date.now() : 0),
        },
        tx,
      );

      // Set mutation_outcome on handler run
      await this.store.updateHandlerRun(
        mutation.handler_run_id,
        { mutation_outcome: "failure" },
        tx,
      );

      // Advance phase to "mutated" (mutate phase complete, outcome known)
      await this.updateConsumerPhase(
        mutation.handler_run_id,
        "mutated",
        undefined,
        tx,
      );

      // Release events — mutation failed, events weren't processed
      await this.store.releaseEvents(mutation.handler_run_id, tx);

      // Clear pending_retry_run_id (if set — no retry needed for failed mutation)
      await this.store.updateWorkflowFields(
        mutation.workflow_id,
        { pending_retry_run_id: "" },
        tx,
      );

      // Clear workflow.error (mutation resolved, no longer needs attention)
      await this.store.updateWorkflowFields(
        mutation.workflow_id,
        { error: "" },
        tx,
      );
    });
  }

  // ==========================================================================
  // Method 7: skipMutation — REMOVED
  //
  // skipMutation is UI-only (only the user can decide to skip). It now lives
  // exclusively in ExecutionModelClient (packages/browser/src/execution-model-client.ts)
  // as resolveMutationSkipped(). No backend code ever calls skipMutation.
  // ==========================================================================

  // ==========================================================================
  // Method 8: createRetryRun
  // ==========================================================================

  /**
   * Create a retry run for a post-mutation failure.
   *
   * Invariant: only called for post-mutation runs. pending_retry_run_id is
   * only set by updateHandlerRunStatus for post-mutation failures or by
   * EMC.resolveMutationSkipped. Pre-mutation failures release events and
   * never set pending_retry_run_id.
   *
   * Throws if the failed run is pre-mutation — guards against caller misuse.
   *
   * Atomically: create new handler_run (at emitting phase), copy results
   * from failed run, transfer event reservations, clear pending_retry.
   *
   * @param failedRunId - The handler run to retry
   * @param sessionId - Session (script_run) for the new run
   * @returns The newly created handler run
   */
  async createRetryRun(
    failedRunId: string,
    sessionId: string,
  ): Promise<HandlerRun> {
    return this.api.db.db.tx(async (tx) => {
      const failedRun = await this.store.getHandlerRun(failedRunId, tx);
      if (!failedRun) throw new Error(`Handler run not found: ${failedRunId}`);

      // Assert post-mutation: mutation_outcome must be "success" or "skipped"
      // (or legacy: phase >= mutated with empty mutation_outcome for pre-v48 data)
      const isPostMutation =
        failedRun.mutation_outcome === "success" ||
        failedRun.mutation_outcome === "skipped" ||
        (failedRun.mutation_outcome === "" &&
          CONSUMER_PHASE_ORDER[failedRun.phase] >=
            CONSUMER_PHASE_ORDER["mutated"]);

      if (!isPostMutation) {
        throw new Error(
          `createRetryRun called on pre-mutation run (phase=${failedRun.phase}, ` +
            `mutation_outcome=${failedRun.mutation_outcome}). Pre-mutation failures ` +
            `release events; no retry needed.`,
        );
      }

      // Create new handler_run at emitting phase
      const newRun = await this.store.createHandlerRun(
        {
          script_run_id: sessionId,
          workflow_id: failedRun.workflow_id,
          handler_type: failedRun.handler_type,
          handler_name: failedRun.handler_name,
          retry_of: failedRunId,
          phase: "emitting",
          // Copy prepare_result from failed run (needed for next() context)
          prepare_result: failedRun.prepare_result,
          input_state: failedRun.input_state,
        },
        tx,
      );

      // Copy mutation_outcome to the new run
      await this.store.updateHandlerRun(
        newRun.id,
        { mutation_outcome: failedRun.mutation_outcome },
        tx,
      );

      // Transfer event reservations from failed run to new run
      // (For skipped mutations, events are already skipped — this is a no-op)
      await this.store.transferReservations(failedRunId, newRun.id, tx);

      // Clear pending_retry_run_id
      await this.store.updateWorkflowFields(
        failedRun.workflow_id,
        { pending_retry_run_id: "" },
        tx,
      );

      return {
        ...newRun,
        mutation_outcome: failedRun.mutation_outcome,
      };
    });
  }

  // ==========================================================================
  // Method 9: finishSession
  // ==========================================================================

  /**
   * Finalize a session (script_run) on the success path.
   *
   * Called by the scheduler when a session has no more work (all consumers
   * processed). Aggregates cost from handler runs and marks completed.
   *
   * Not transactional with handler runs — this is a derivative record.
   * If the process crashes before this runs, the session stays open and
   * is recovered on startup by recoverUnfinishedSessions().
   *
   * @param sessionId - Script run ID
   */
  async finishSession(sessionId: string): Promise<void> {
    const runs = await this.store.getHandlerRunsBySession(sessionId);
    const totalCost = runs.reduce((sum, r) => sum + (r.cost || 0), 0);

    await this.store.finishSession(
      sessionId,
      new Date().toISOString(),
      "completed",
      "",
      "",
      "",
      totalCost,
    );
  }

  // ==========================================================================
  // updateMutationStatus (non-terminal transitions)
  // ==========================================================================

  /**
   * Update mutation to a non-terminal status. No side effects on handler runs,
   * events, or workflow — just updates the mutation record.
   *
   * Valid transitions:
   *   - pending → in_flight (tool wrapper, before external call)
   *   - in_flight → needs_reconcile (uncertain outcome, tool supports reconciliation)
   *   - in_flight → indeterminate (uncertain outcome, no reconciliation method)
   *   - needs_reconcile → indeterminate (reconciliation exhausted)
   *
   * These transitions may happen during an active run or after the run is
   * already paused. Either way, this is just a label change. The handler
   * state machine handles run status separately.
   *
   * @param mutationId - Mutation record ID
   * @param newStatus - Target mutation status
   * @param opts - Options (error, tool info, reconciliation metadata)
   */
  async updateMutationStatus(
    mutationId: string,
    newStatus: MutationStatus,
    opts?: UpdateMutationStatusOpts,
  ): Promise<void> {
    // Only non-terminal transitions allowed here
    const allowedStatuses: MutationStatus[] = [
      "in_flight",
      "needs_reconcile",
      "indeterminate",
    ];
    if (!allowedStatuses.includes(newStatus)) {
      throw new Error(
        `updateMutationStatus only handles non-terminal transitions. ` +
          `Use applyMutation/failMutation for terminal outcomes (or EMC for skip). ` +
          `Got: ${newStatus}`,
      );
    }

    const updateFields: any = { status: newStatus };

    if (opts?.error !== undefined) updateFields.error = opts.error;
    if (opts?.toolNamespace !== undefined)
      updateFields.tool_namespace = opts.toolNamespace;
    if (opts?.toolMethod !== undefined)
      updateFields.tool_method = opts.toolMethod;
    if (opts?.params !== undefined) updateFields.params = opts.params;
    if (opts?.idempotencyKey !== undefined)
      updateFields.idempotency_key = opts.idempotencyKey;
    if (opts?.nextReconcileAt !== undefined)
      updateFields.next_reconcile_at = opts.nextReconcileAt;

    await this.store.updateMutation(mutationId, updateFields);
  }

  // ==========================================================================
  // Auxiliary methods
  //
  // pauseWorkflow / resumeWorkflow — REMOVED
  // These are UI-only operations. They now live exclusively in
  // ExecutionModelClient (packages/browser/src/execution-model-client.ts).
  // No backend code ever calls them.
  // ==========================================================================

  /**
   * Block a workflow with an error — scheduler-level decision.
   *
   * Sets workflow.error (system-controlled). Does NOT touch workflow.status
   * (user-controlled). Optionally clears pending_retry_run_id (e.g. when
   * max network retries are exceeded).
   *
   * Called by the scheduler when a workflow needs user attention for reasons
   * outside the handler execution model (missing config, max retries, etc.).
   */
  async blockWorkflow(
    workflowId: string,
    error: string,
    opts?: { clearPendingRetry?: boolean },
  ): Promise<void> {
    const fields: Record<string, any> = { error };
    if (opts?.clearPendingRetry) fields.pending_retry_run_id = "";
    await this.store.updateWorkflowFields(workflowId, fields);
  }

  /**
   * Exit maintenance mode — called after maintainer fixes script.
   * Sets workflow.maintenance = false. Does NOT clear pending_retry_run_id —
   * if one was set for a post-mutation failure, the scheduler will process it
   * via createRetryRun after maintenance clears.
   */
  async exitMaintenanceMode(workflowId: string): Promise<void> {
    await this.store.updateWorkflowFields(workflowId, {
      maintenance: false,
    });
  }

  /**
   * Recover crashed runs on startup.
   *
   * Finds handler runs with status='active' (left over from a crash) and
   * applies the mutation-boundary logic to determine the recovery path.
   *
   * Must be called during startup recovery.
   */
  async recoverCrashedRuns(): Promise<void> {
    const workflowIds =
      await this.store.getWorkflowsWithIncompleteRuns();

    for (const workflowId of workflowIds) {
      const incompleteRuns =
        await this.store.getIncompleteHandlerRuns(workflowId);

      for (const run of incompleteRuns) {
        log(
          "Recovering crashed run %s (phase=%s, mutation_outcome=%s)",
          run.id,
          run.phase,
          run.mutation_outcome,
        );

        // Determine recovery path based on mutation boundary
        if (run.phase === "mutating" && run.mutation_outcome === "") {
          // Check if there's an in-flight mutation
          const mutation = await this.store.getMutationByRunId(
            run.id,
          );
          if (
            mutation &&
            (mutation.status === "in_flight" ||
              mutation.status === "needs_reconcile")
          ) {
            // In-flight mutation — outcome uncertain, need reconciliation
            await this.updateHandlerRunStatus(
              run.id,
              "paused:reconciliation",
              {
                error: "Mutation outcome uncertain (crash during execution)",
              },
            );
            continue;
          }
        }

        // For all other cases: use the standard pre/post-mutation logic
        // via updateHandlerRunStatus which handles event disposition correctly
        await this.updateHandlerRunStatus(run.id, "crashed", {
          error: "Process crashed during execution",
        });
      }
    }
  }

  /**
   * Recover unfinished sessions on startup.
   *
   * Finds open sessions (no end_timestamp) where ALL handler runs are committed.
   * Calls finishSession() for each.
   *
   * Independent of recoverCrashedRuns() — no ordering dependency.
   * Sessions with failed/paused runs are already finalized by updateHandlerRunStatus.
   * Sessions with active (crashed) runs are handled by recoverCrashedRuns.
   * This only covers: all runs committed but finishSession didn't run before crash.
   */
  async recoverUnfinishedSessions(): Promise<void> {
    const activeSessions = await this.store.getActiveSessions();

    for (const session of activeSessions) {
      const runs = await this.store.getHandlerRunsBySession(session.id);

      // Only finish sessions where ALL runs are committed
      const allCommitted =
        runs.length > 0 && runs.every((r) => r.status === "committed");

      if (allCommitted) {
        log("Recovering unfinished session %s (all runs committed)", session.id);
        await this.finishSession(session.id);
      }
    }
  }

  /**
   * Recover maintenance mode on startup.
   *
   * Finds workflows with maintenance=true and no active maintainer task.
   * Creates a maintenance task for each (covers crash window between
   * updateHandlerRunStatus setting the flag and createMaintenanceTask running).
   *
   * Note: The actual task creation is left to the caller (scheduler/startup),
   * since it depends on the planner/AI system which is outside the execution model.
   * This method returns the workflow IDs that need maintenance tasks.
   */
  async recoverMaintenanceMode(): Promise<string[]> {
    const workflows = await this.store.listWorkflows();
    const needsMaintenance: string[] = [];

    for (const workflow of workflows) {
      if (workflow.maintenance) {
        // Check if there's already an active maintainer task
        // (The caller needs to verify this against the task system)
        needsMaintenance.push(workflow.id);
      }
    }

    return needsMaintenance;
  }

  // ==========================================================================
  // Diagnostic assertion
  // ==========================================================================

  /**
   * Assert that no orphaned reserved events exist.
   *
   * With the new model, all event transitions happen atomically. Every crash
   * scenario is covered by recoverCrashedRuns(). If orphaned events exist,
   * it's a bug in the execution model — we log a loud error but do NOT
   * release them (to avoid hiding the bug).
   *
   * Run AFTER recoverCrashedRuns() so active runs are already handled.
   */
  async assertNoOrphanedReservedEvents(): Promise<void> {
    const results = await this.api.db.db.execO<{
      event_id: string;
      reserved_by_run_id: string;
      run_status: string | null;
      run_phase: string | null;
    }>(
      `SELECT
        e.id as event_id,
        e.reserved_by_run_id,
        h.status as run_status,
        h.phase as run_phase
      FROM events e
      LEFT JOIN handler_runs h ON h.id = e.reserved_by_run_id
      WHERE e.status = 'reserved'
        AND (
          h.id IS NULL
          OR (
            h.status != 'active'
            AND h.id NOT IN (
              SELECT pending_retry_run_id FROM workflows
              WHERE pending_retry_run_id != ''
            )
          )
        )`,
    );

    if (results && results.length > 0) {
      log(
        "BUG: Found %d orphaned reserved events! Details:",
        results.length,
      );
      for (const r of results) {
        log(
          "  event=%s reserved_by=%s run_status=%s run_phase=%s",
          r.event_id,
          r.reserved_by_run_id,
          r.run_status || "MISSING",
          r.run_phase || "MISSING",
        );
      }
      // Do NOT release — surface the bug for investigation
      console.error(
        `[ExecutionModelManager] BUG: ${results.length} orphaned reserved events found. ` +
          `This indicates a bug in the execution model. Check debug logs for details.`,
      );
    }
  }

  // ==========================================================================
  // Internal helpers (private)
  // ==========================================================================

  /**
   * Handle event disposition for a non-committed consumer handler run.
   *
   * The mutation boundary determines what happens to reserved events:
   *   a. Pre-mutation (phase < mutated, or mutation_outcome = "failure"):
   *      → release events back to pending (can be reprocessed by fresh run)
   *   b. Post-mutation (phase in mutated/emitting, mutation_outcome != "failure"):
   *      → set pending_retry_run_id, events stay reserved for retry
   *   c. Indeterminate (phase = mutating, mutation in-flight):
   *      → set pending_retry_run_id + workflow.error, events stay reserved
   */
  private async _handleEventDisposition(
    run: HandlerRun,
    tx: DBInterface,
  ): Promise<void> {
    const phaseOrder = CONSUMER_PHASE_ORDER[run.phase] ?? 0;

    // Case (a): Pre-mutation — release events
    // mutation_outcome = "failure" is also treated as pre-mutation
    // (failed mutation = events weren't processed, safe to release)
    if (phaseOrder < CONSUMER_PHASE_ORDER["mutated"] || run.mutation_outcome === "failure") {
      await this.store.releaseEvents(run.id, tx);
      return;
    }

    // Case (c): Indeterminate — mutation in-flight during mutating phase
    // mutation_outcome is still "" (not yet resolved)
    if (run.phase === "mutating" && run.mutation_outcome === "") {
      await this.store.updateWorkflowFields(
        run.workflow_id,
        {
          pending_retry_run_id: run.id,
          error: "Mutation outcome uncertain",
        },
        tx,
      );
      return;
    }

    // Case (b): Post-mutation — events stay reserved, set pending_retry
    // (mutation_outcome = "success" or "skipped", or legacy "" with phase >= mutated)
    await this.store.updateWorkflowFields(
      run.workflow_id,
      { pending_retry_run_id: run.id },
      tx,
    );
  }

  /**
   * Finalize the session (script_run) on failure/paused/crashed.
   *
   * Handler failure always ends the session. Committed runs don't end the
   * session — the scheduler may run more consumers.
   */
  private async _finalizeSession(
    run: HandlerRun,
    error: string,
    tx: DBInterface,
  ): Promise<void> {
    // Aggregate cost from all handler runs in this session
    const sessionRuns = await this.store.getHandlerRunsBySession(
      run.script_run_id,
      tx,
    );
    const totalCost = sessionRuns.reduce((sum, r) => sum + (r.cost || 0), 0);

    await this.store.finishSession(
      run.script_run_id,
      new Date().toISOString(),
      "failed",
      error,
      "",
      "",
      totalCost,
      tx,
    );
  }

  /**
   * Determine the workflow.error value for a given handler run status.
   *
   * Returns null if no error should be set (the status is handled by
   * other mechanisms — maintenance for logic errors, retry for transient).
   */
  private _getWorkflowErrorForStatus(
    status: RunStatus,
    errorMessage?: string,
  ): string | null {
    switch (status) {
      case "paused:approval":
        return errorMessage || "Authentication required";
      case "paused:reconciliation":
        return errorMessage || "Mutation outcome uncertain";
      case "failed:internal":
        return errorMessage || "Internal error";
      // These statuses don't set workflow.error:
      // - failed:logic → maintenance flag handles it
      // - paused:transient → retry handles it
      // - crashed → crash recovery handles it
      // - committed → success, no error
      default:
        return null;
    }
  }

  /**
   * Assert that a mutation is not in a terminal state.
   *
   * Terminal states: "applied", "failed".
   * "indeterminate" is accepted (resolvable by user action).
   */
  private _assertMutationNotTerminal(
    mutation: Mutation,
    methodName: string,
  ): void {
    if (mutation.status === "applied" || mutation.status === "failed") {
      throw new Error(
        `${methodName}: Mutation ${mutation.id} is already terminal ` +
          `(status=${mutation.status}). Cannot modify terminal mutations.`,
      );
    }
  }
}
