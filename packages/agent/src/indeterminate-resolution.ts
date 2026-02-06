/**
 * Indeterminate Mutation Resolution (exec-14)
 *
 * Handles user resolution of indeterminate mutations - mutations whose
 * outcome is uncertain due to crashes, timeouts, or ambiguous errors.
 *
 * Per exec-14 spec, since we're not implementing auto-reconciliation,
 * all uncertain outcomes immediately become indeterminate and require
 * user resolution.
 *
 * Resolution options:
 * - "happened" (user_assert_applied): User verified mutation succeeded
 * - "did_not_happen" (user_assert_failed): User verified mutation failed
 * - "skip" (user_skip): User wants to skip this event
 */

import {
  KeepDbApi,
  Mutation,
  MutationResolution,
  HandlerRun,
  DBInterface,
} from "@app/db";
import { createRetryRun } from "./handler-state-machine";
import debug from "debug";

const log = debug("indeterminate-resolution");

// ============================================================================
// Types
// ============================================================================

/**
 * User resolution action for indeterminate mutations.
 */
export type IndeterminateResolution = "happened" | "did_not_happen" | "skip";

/**
 * Result of mutation resolution.
 */
export interface ResolutionResult {
  success: boolean;
  /** The resolved mutation */
  mutation: Mutation;
  /** If resolution created a retry run, this is its ID */
  retryRunId?: string;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Mutation result for the next phase.
 */
export interface MutationResult {
  status: "applied" | "skipped" | "none";
  result?: unknown;
}

// ============================================================================
// Resolution Logic
// ============================================================================

/**
 * Map user resolution action to MutationResolution type.
 */
function actionToMutationResolution(action: IndeterminateResolution): MutationResolution {
  switch (action) {
    case "happened":
      return "user_assert_applied";
    case "did_not_happen":
      return "user_assert_failed";
    case "skip":
      return "user_skip";
  }
}

/**
 * Resolve an indeterminate mutation based on user action.
 *
 * Per exec-14 spec:
 * - "happened": Mark as applied, resume execution from mutated phase
 * - "did_not_happen": Mark as failed, create retry run
 * - "skip": Mark as failed, skip reserved events, commit run
 *
 * @param api - Database API
 * @param mutationId - The mutation to resolve
 * @param action - User's resolution action
 * @returns Resolution result
 */
export async function resolveIndeterminateMutation(
  api: KeepDbApi,
  mutationId: string,
  action: IndeterminateResolution
): Promise<ResolutionResult> {
  const mutation = await api.mutationStore.get(mutationId);

  if (!mutation) {
    return {
      success: false,
      mutation: null as unknown as Mutation,
      error: `Mutation ${mutationId} not found`,
    };
  }

  if (mutation.status !== "indeterminate") {
    return {
      success: false,
      mutation,
      error: `Mutation is not indeterminate (status: ${mutation.status})`,
    };
  }

  const run = await api.handlerRunStore.get(mutation.handler_run_id);
  if (!run) {
    return {
      success: false,
      mutation,
      error: `Handler run ${mutation.handler_run_id} not found`,
    };
  }

  const resolution = actionToMutationResolution(action);
  log(`Resolving mutation ${mutationId} with action: ${action} (${resolution})`);

  switch (action) {
    case "happened":
      return await resolveAsHappened(api, mutation, run, resolution);
    case "did_not_happen":
      return await resolveAsDidNotHappen(api, mutation, run, resolution);
    case "skip":
      return await resolveAsSkip(api, mutation, run, resolution);
  }
}

/**
 * Resolve mutation as "happened" - user verified it succeeded.
 *
 * - Mark mutation as applied
 * - Set run status to active, phase to mutated
 * - Resume workflow
 */
async function resolveAsHappened(
  api: KeepDbApi,
  mutation: Mutation,
  run: HandlerRun,
  resolution: MutationResolution
): Promise<ResolutionResult> {
  await api.db.db.tx(async (tx: DBInterface) => {
    // Mark mutation as applied with user resolution
    await api.mutationStore.update(
      mutation.id,
      {
        status: "applied",
        resolved_by: resolution,
        resolved_at: Date.now(),
      },
      tx
    );

    // Resume handler run at mutated phase
    await api.handlerRunStore.update(
      run.id,
      {
        phase: "mutated",
        status: "active",
        error: "", // Clear the error
      },
      tx
    );

    // Resume workflow
    await api.scriptStore.updateWorkflowFields(
      run.workflow_id,
      { status: "active" },
      tx
    );
  });

  log(`Mutation ${mutation.id} resolved as happened, run ${run.id} resumed at mutated phase`);

  // Fetch updated mutation
  const updatedMutation = await api.mutationStore.get(mutation.id);

  return {
    success: true,
    mutation: updatedMutation!,
  };
}

/**
 * Resolve mutation as "did not happen" - user verified it failed.
 *
 * - Mark mutation as failed
 * - Create retry run via exec-10 retry chain
 * - Resume workflow
 */
async function resolveAsDidNotHappen(
  api: KeepDbApi,
  mutation: Mutation,
  run: HandlerRun,
  resolution: MutationResolution
): Promise<ResolutionResult> {
  // Use wrapper to get the retry run ID out of the transaction
  const result: { retryRunId: string } = { retryRunId: "" };

  await api.db.db.tx(async (tx: DBInterface) => {
    // Mark mutation as failed with user resolution
    await api.mutationStore.update(
      mutation.id,
      {
        status: "failed",
        resolved_by: resolution,
        resolved_at: Date.now(),
      },
      tx
    );

    // Mark current run as failed (not crashed - user resolved it)
    await api.handlerRunStore.update(
      run.id,
      {
        status: "failed:logic", // User confirmed mutation failed, so it's a known failure
        error: "User confirmed mutation did not complete",
        end_timestamp: new Date().toISOString(),
      },
      tx
    );
  });

  // Create retry run (outside transaction since createRetryRun uses its own tx)
  try {
    const retryRun = await createRetryRun({
      previousRun: run,
      previousRunStatus: "failed:logic",
      reason: "user_retry",
      api,
    });
    result.retryRunId = retryRun.id;
    log(`Created retry run ${retryRun.id} for mutation ${mutation.id} resolution`);
  } catch (error) {
    log(`Failed to create retry run: ${error}`);
    // Don't fail the resolution - the mutation is still resolved
  }

  // Resume workflow
  await api.scriptStore.updateWorkflowFields(run.workflow_id, {
    status: "active",
  });

  log(`Mutation ${mutation.id} resolved as did_not_happen, retry run created`);

  // Fetch updated mutation
  const updatedMutation = await api.mutationStore.get(mutation.id);

  return {
    success: true,
    mutation: updatedMutation!,
    retryRunId: result.retryRunId || undefined,
  };
}

/**
 * Resolve mutation as "skip" - user wants to skip this event.
 *
 * - Mark mutation as failed with skip resolution
 * - Skip reserved events
 * - Commit run
 * - Resume workflow
 */
async function resolveAsSkip(
  api: KeepDbApi,
  mutation: Mutation,
  run: HandlerRun,
  resolution: MutationResolution
): Promise<ResolutionResult> {
  await api.db.db.tx(async (tx: DBInterface) => {
    // Mark mutation as failed with skip resolution
    await api.mutationStore.update(
      mutation.id,
      {
        status: "failed",
        resolved_by: resolution,
        resolved_at: Date.now(),
      },
      tx
    );

    // Skip reserved events
    await api.eventStore.skipEvents(run.id, tx);

    // Commit run (with skip - it completed by skipping)
    await api.handlerRunStore.update(
      run.id,
      {
        phase: "committed",
        status: "committed",
        error: "", // Clear the error
        end_timestamp: new Date().toISOString(),
      },
      tx
    );

    // Increment session handler count
    await api.scriptStore.incrementHandlerCount(run.script_run_id, tx);

    // Resume workflow
    await api.scriptStore.updateWorkflowFields(
      run.workflow_id,
      { status: "active" },
      tx
    );
  });

  log(`Mutation ${mutation.id} resolved as skip, events skipped, run ${run.id} committed`);

  // Fetch updated mutation
  const updatedMutation = await api.mutationStore.get(mutation.id);

  return {
    success: true,
    mutation: updatedMutation!,
  };
}

// ============================================================================
// Mutation Result for Next Phase
// ============================================================================

/**
 * Get the mutation result for the next phase.
 *
 * Per exec-14 spec, the next phase receives appropriate result based on
 * mutation status and resolution.
 *
 * @param mutation - The mutation record
 * @returns MutationResult for the next phase
 */
export function getMutationResultForNext(mutation: Mutation | null): MutationResult {
  if (!mutation) {
    return { status: "none" };
  }

  switch (mutation.status) {
    case "applied":
      // Normal success or user_assert_applied
      return {
        status: "applied",
        result: mutation.result ? JSON.parse(mutation.result) : null,
      };

    case "failed":
      if (mutation.resolved_by === "user_skip") {
        // User chose to skip - next phase should know
        return { status: "skipped" };
      }
      // If failed and not skipped, run shouldn't reach next
      // (either retrying or terminated)
      throw new Error("Unexpected: failed mutation without skip in next phase");

    case "pending":
    case "in_flight":
    case "needs_reconcile":
    case "indeterminate":
      // These states shouldn't reach next phase
      throw new Error(`Unexpected mutation status in next phase: ${mutation.status}`);

    default:
      return { status: "none" };
  }
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get all indeterminate mutations that need user resolution.
 *
 * @param api - Database API
 * @returns Array of indeterminate mutations
 */
export async function getIndeterminateMutations(
  api: KeepDbApi
): Promise<Mutation[]> {
  return api.mutationStore.getIndeterminate();
}

/**
 * Get indeterminate mutations for a specific workflow.
 *
 * @param api - Database API
 * @param workflowId - Workflow ID
 * @returns Array of indeterminate mutations for the workflow
 */
export async function getIndeterminateMutationsForWorkflow(
  api: KeepDbApi,
  workflowId: string
): Promise<Mutation[]> {
  return api.mutationStore.getByWorkflow(workflowId, { status: "indeterminate" });
}
