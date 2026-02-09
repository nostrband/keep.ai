/**
 * Reconciliation Scheduler (exec-18)
 *
 * Per docs/dev/13-reconciliation.md §13.7.4:
 * While in needs_reconcile, host performs reconciliation attempts with backoff.
 *
 * This scheduler:
 * 1. Periodically checks for mutations due for reconciliation
 * 2. Attempts reconciliation using the registry
 * 3. Handles outcomes (applied/failed/retry/exhausted)
 * 4. Updates mutation state and resumes workflows as needed
 */

import { KeepDbApi, Mutation } from "@app/db";
import { ReconciliationRegistry } from "./registry";
import {
  type MutationParams,
  type ReconciliationPolicy,
  DEFAULT_RECONCILIATION_POLICY,
  calculateBackoff,
} from "./types";
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
  private policy: ReconciliationPolicy;
  private checkIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(config: ReconciliationSchedulerConfig) {
    this.api = config.api;
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
   */
  private async handleApplied(mutation: Mutation, result: unknown): Promise<void> {
    await this.api.mutationStore.markApplied(
      mutation.id,
      result ? JSON.stringify(result) : ""
    );

    // Resume the workflow
    await this.resumeWorkflow(mutation);
  }

  /**
   * Handle failed reconciliation (mutation confirmed not applied).
   */
  private async handleFailed(mutation: Mutation): Promise<void> {
    await this.api.mutationStore.markFailed(
      mutation.id,
      "Reconciliation confirmed mutation did not complete"
    );

    // Resume the workflow - mutate phase will be re-executed
    await this.resumeWorkflow(mutation);
  }

  /**
   * Handle exhausted reconciliation attempts.
   */
  private async handleExhausted(mutation: Mutation): Promise<void> {
    await this.api.mutationStore.markIndeterminate(
      mutation.id,
      `Reconciliation exhausted after ${mutation.reconcile_attempts} attempts`
    );

    // Pause the workflow - needs user resolution
    await this.api.scriptStore.updateWorkflowFields(mutation.workflow_id, {
      status: "paused",
    });
    log(`Workflow ${mutation.workflow_id} paused due to exhausted reconciliation`);
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

  /**
   * Resume a workflow after reconciliation resolves.
   */
  private async resumeWorkflow(mutation: Mutation): Promise<void> {
    // Get the workflow
    const workflow = await this.api.scriptStore.getWorkflow(mutation.workflow_id);
    if (!workflow) {
      log(`Workflow ${mutation.workflow_id} not found, cannot resume`);
      return;
    }

    // Get the handler run associated with this mutation
    const handlerRun = await this.api.handlerRunStore.get(mutation.handler_run_id);

    // Wrap both updates in a transaction for atomicity — crash between them
    // would leave workflow active but handler_run paused, preventing recovery
    await this.api.db.db.tx(async (tx) => {
      if (workflow.status === "paused") {
        await this.api.scriptStore.updateWorkflowFields(
          mutation.workflow_id,
          { status: "active" },
          tx
        );
        log(`Workflow ${mutation.workflow_id} resumed after reconciliation`);
      }

      if (handlerRun && handlerRun.status === "paused:reconciliation") {
        await this.api.handlerRunStore.update(
          handlerRun.id,
          { status: "active" },
          tx
        );
        log(`Handler run ${handlerRun.id} resumed after reconciliation`);
      }
    });
  }
}
