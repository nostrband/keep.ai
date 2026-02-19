/**
 * Reconciliation Scheduler (exec-18)
 *
 * Per docs/dev/13-reconciliation.md §13.7.4:
 * While in needs_reconcile, host performs reconciliation attempts with backoff.
 *
 * This scheduler:
 * 1. Periodically checks for mutations due for reconciliation
 * 2. Attempts reconciliation using the registry
 * 3. Handles outcomes via EMM (applied/failed/retry/exhausted)
 *
 * Resolution paths (no manual "resumeWorkflow" needed):
 * - Applied: emm.applyMutation(setPendingRetry) → scheduler retry path → next()
 * - Failed: emm.failMutation() → events released → scheduler runs fresh session
 * - Exhausted: emm.updateMutationStatus(indeterminate) → user must resolve
 */

import { KeepDbApi, Mutation } from "@app/db";
import { ReconciliationRegistry } from "./registry";
import {
  type MutationParams,
  type ReconciliationPolicy,
  DEFAULT_RECONCILIATION_POLICY,
  calculateBackoff,
} from "./types";
import { ExecutionModelManager } from "../execution-model";
import debug from "debug";

const log = debug("reconciliation:scheduler");

export interface ReconciliationSchedulerConfig {
  /** Database API */
  api: KeepDbApi;
  /** Reconciliation policy */
  policy?: ReconciliationPolicy;
  /** Check interval in milliseconds (default: 10 seconds) */
  checkIntervalMs?: number;
}

/**
 * Background scheduler for mutation reconciliation.
 *
 * Runs in the background, periodically checking for mutations that need
 * reconciliation and attempting to reconcile them.
 */
export class ReconciliationScheduler {
  private api: KeepDbApi;
  private emm: ExecutionModelManager;
  private policy: ReconciliationPolicy;
  private checkIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(config: ReconciliationSchedulerConfig) {
    this.api = config.api;
    this.emm = new ExecutionModelManager(config.api);
    this.policy = config.policy || DEFAULT_RECONCILIATION_POLICY;
    this.checkIntervalMs = config.checkIntervalMs || 10_000;
  }

  /**
   * Start the reconciliation scheduler.
   */
  start(): void {
    if (this.interval) {
      log("Scheduler already running");
      return;
    }

    log(`Starting reconciliation scheduler (interval: ${this.checkIntervalMs}ms)`);
    this.interval = setInterval(() => this.checkReconciliation(), this.checkIntervalMs);

    // Also run immediately
    this.checkReconciliation();
  }

  /**
   * Stop the reconciliation scheduler.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      log("Reconciliation scheduler stopped");
    }
  }

  /**
   * Check for and process mutations due for reconciliation.
   */
  private async checkReconciliation(): Promise<void> {
    // Prevent concurrent runs
    if (this.isRunning) {
      log("Reconciliation check already in progress, skipping");
      return;
    }

    this.isRunning = true;
    try {
      const dueMutations = await this.api.mutationStore.getDueForReconciliation();

      if (dueMutations.length === 0) {
        return;
      }

      log(`Found ${dueMutations.length} mutations due for reconciliation`);

      // Process each mutation
      for (const mutation of dueMutations) {
        await this.reconcileMutation(mutation);
      }
    } catch (error) {
      log(`Error checking reconciliation: ${error}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Attempt to reconcile a single mutation.
   */
  private async reconcileMutation(mutation: Mutation): Promise<void> {
    log(`Reconciling mutation ${mutation.id} (attempt ${mutation.reconcile_attempts + 1})`);

    // Check if we've exhausted attempts
    if (mutation.reconcile_attempts >= this.policy.maxAttempts) {
      log(`Mutation ${mutation.id} exhausted reconciliation attempts`);
      await this.handleExhausted(mutation);
      return;
    }

    // Build mutation params
    const params: MutationParams = {
      toolNamespace: mutation.tool_namespace,
      toolMethod: mutation.tool_method,
      params: mutation.params,
      idempotencyKey: mutation.idempotency_key || undefined,
    };

    // Check if reconcile method exists
    if (!ReconciliationRegistry.hasReconcileMethod(params.toolNamespace, params.toolMethod)) {
      log(`No reconcile method for ${params.toolNamespace}:${params.toolMethod}, marking indeterminate`);
      await this.handleExhausted(mutation);
      return;
    }

    // Attempt reconciliation
    try {
      const result = await ReconciliationRegistry.reconcile(params);

      if (!result) {
        // Shouldn't happen, but handle it
        log(`Reconciliation returned null for mutation ${mutation.id}`);
        await this.scheduleNextAttempt(mutation);
        return;
      }

      switch (result.status) {
        case "applied":
          log(`Reconciliation confirmed applied for mutation ${mutation.id}`);
          await this.handleApplied(mutation, result.result);
          break;

        case "failed":
          log(`Reconciliation confirmed failed for mutation ${mutation.id}`);
          await this.handleFailed(mutation);
          break;

        case "retry":
          log(`Reconciliation needs retry for mutation ${mutation.id}`);
          await this.scheduleNextAttempt(mutation);
          break;

        default:
          log(`Unknown reconciliation result status for mutation ${mutation.id}`);
          await this.scheduleNextAttempt(mutation);
          break;
      }
    } catch (error) {
      log(`Reconciliation error for mutation ${mutation.id}: ${error}`);
      await this.scheduleNextAttempt(mutation);
    }
  }

  /**
   * Handle successful reconciliation (mutation confirmed applied).
   *
   * Uses EMM.applyMutation which clears workflow.error — this unblocks the
   * scheduler to process the existing pending_retry_run_id (set when the run
   * entered paused:reconciliation). The scheduler then calls createRetryRun()
   * → new run at emitting → next().
   */
  private async handleApplied(mutation: Mutation, result: unknown): Promise<void> {
    await this.emm.applyMutation(mutation.id, {
      result: result ? JSON.stringify(result) : "",
      resolvedBy: "reconciliation",
    });
    log(`Mutation ${mutation.id} applied via reconciliation`);
  }

  /**
   * Handle failed reconciliation (mutation confirmed not applied).
   *
   * Uses EMM.failMutation which atomically: sets mutation_outcome=failure,
   * advances phase, releases events, clears pending_retry, clears error.
   * The scheduler runs a fresh session to reprocess the released events.
   */
  private async handleFailed(mutation: Mutation): Promise<void> {
    await this.emm.failMutation(mutation.id, {
      error: "Reconciliation confirmed mutation did not complete",
      resolvedBy: "reconciliation",
    });
    log(`Mutation ${mutation.id} failed via reconciliation, events released`);
  }

  /**
   * Handle exhausted reconciliation attempts.
   *
   * Marks mutation as indeterminate — user must resolve it manually.
   * workflow.error and pending_retry_run_id are already set from when the run
   * entered paused:reconciliation (via EMM.updateHandlerRunStatus), so no
   * workflow field changes are needed here.
   */
  private async handleExhausted(mutation: Mutation): Promise<void> {
    await this.emm.updateMutationStatus(mutation.id, "indeterminate", {
      error: `Reconciliation exhausted after ${mutation.reconcile_attempts} attempts`,
    });
    log(`Mutation ${mutation.id} marked indeterminate after exhausted reconciliation`);
  }

  /**
   * Schedule the next reconciliation attempt with exponential backoff.
   */
  private async scheduleNextAttempt(mutation: Mutation): Promise<void> {
    const nextAttempt = mutation.reconcile_attempts + 1;
    const delayMs = calculateBackoff(nextAttempt, this.policy);

    await this.api.mutationStore.scheduleNextReconcile(mutation.id, delayMs);
    log(`Scheduled next reconciliation for mutation ${mutation.id} in ${delayMs}ms`);
  }
}
