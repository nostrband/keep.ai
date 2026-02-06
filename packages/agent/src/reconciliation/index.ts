/**
 * Mutation Reconciliation Module (exec-18)
 *
 * Per docs/dev/13-reconciliation.md, this module provides:
 * - Types for reconciliation contract
 * - Registry for reconcile methods
 * - Connector-specific reconcile implementations
 * - Scheduler for background reconciliation
 */

// Types
export {
  type ReconcileResult,
  type MutationParams,
  type ReconcileMethod,
  type ReconcilableTool,
  type ReconciliationPolicy,
  DEFAULT_RECONCILIATION_POLICY,
  calculateBackoff,
} from "./types";

// Registry
export { ReconciliationRegistry } from "./registry";

// Connector reconcile implementations
export { registerGmailReconcileMethods, createGmailSendReconciler } from "./gmail-reconcile";

// Background reconciliation scheduler
export { ReconciliationScheduler, type ReconciliationSchedulerConfig } from "./scheduler";
