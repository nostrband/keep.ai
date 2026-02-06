/**
 * Mutation Reconciliation Types (exec-18)
 *
 * Per docs/dev/13-reconciliation.md, these types define the contract between
 * mutation tools and the reconciliation system.
 */

import type { ReconcileResult } from "@app/db";

// Re-export ReconcileResult from db for convenience
export type { ReconcileResult };

/**
 * Mutation parameters stored for reconciliation.
 * Tools must provide enough context to verify mutation outcome.
 */
export interface MutationParams {
  /** Tool namespace (e.g., "Gmail", "GSheets") */
  toolNamespace: string;
  /** Tool method (e.g., "send", "appendRow") */
  toolMethod: string;
  /** Tool-specific parameters in JSON format */
  params: string;
  /** Idempotency key for deduplication/reconciliation */
  idempotencyKey?: string;
}

/**
 * Reconcile method signature for mutation tools.
 *
 * Per §13.6.2: For each mutator operation that can be reconciled,
 * the connector provides a reconcile method.
 *
 * Semantics:
 * - Returns status=applied along with result if the mutation already happened
 * - Returns status=failed if the mutation definitely did not happen
 * - Returns status=retry if reconciliation should be retried
 */
export type ReconcileMethod = (params: MutationParams) => Promise<ReconcileResult>;

/**
 * Registry entry for a reconcilable mutation tool.
 */
export interface ReconcilableTool {
  /** Tool namespace (e.g., "Gmail") */
  namespace: string;
  /** Tool method (e.g., "send") */
  method: string;
  /** Reconcile method for this tool */
  reconcile: ReconcileMethod;
}

/**
 * Configuration for reconciliation policy.
 * Per docs/dev/15-host-policies.md §15.3.
 */
export interface ReconciliationPolicy {
  /** Maximum reconciliation attempts before giving up */
  maxAttempts: number;
  /** Base backoff delay in milliseconds */
  baseBackoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** Timeout for immediate reconciliation attempt */
  immediateTimeoutMs: number;
}

/**
 * Default reconciliation policy.
 */
export const DEFAULT_RECONCILIATION_POLICY: ReconciliationPolicy = {
  maxAttempts: 5,
  baseBackoffMs: 10_000, // 10 seconds
  maxBackoffMs: 10 * 60 * 1000, // 10 minutes
  immediateTimeoutMs: 30_000, // 30 seconds
};

/**
 * Calculate exponential backoff delay.
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param policy - Reconciliation policy
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  policy: ReconciliationPolicy = DEFAULT_RECONCILIATION_POLICY
): number {
  // Exponential backoff: base * 2^(attempt-1)
  const exponentialDelayMs = policy.baseBackoffMs * Math.pow(2, attempt - 1);
  return Math.min(exponentialDelayMs, policy.maxBackoffMs);
}
