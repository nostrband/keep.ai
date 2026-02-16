/**
 * Indeterminate Mutation Utilities (exec-14)
 *
 * Helpers for working with indeterminate mutations — mutations whose
 * outcome is uncertain due to crashes, timeouts, or ambiguous errors.
 *
 * Resolution is handled client-side via useResolveMutation hook (dbWrites.ts).
 */

import {
  KeepDbApi,
  Mutation,
} from "@app/db";

// ============================================================================
// Types
// ============================================================================

/**
 * Mutation result for the next phase.
 */
export interface MutationResult {
  status: "applied" | "skipped" | "none";
  result?: unknown;
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
