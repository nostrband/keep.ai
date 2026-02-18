/**
 * Session Orchestration (exec-07)
 *
 * Session-based workflow execution using `script_runs` as the session container.
 * A session runs producers, then loops consumers until work is done or budget
 * is exhausted.
 *
 * See specs/exec-07-session-orchestration.md for design details.
 */

import { KeepDbApi, Workflow, ScriptRun, HandlerRun, isFailedStatus, isPausedStatus, DBInterface } from "@app/db";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import {
  executeHandler,
  HandlerExecutionContext,
  HandlerResult,
  getStartPhaseForRetry,
  shouldCopyResults,
} from "./handler-state-machine";
import { WorkflowConfig } from "./workflow-validator";
import { getRunStatusForError } from "./failure-handling";
import type { SchedulerStateManager } from "./scheduler-state";
import debug from "debug";

const log = debug("session-orchestration");

// ============================================================================
// Types
// ============================================================================

/**
 * Session trigger type.
 */
export type SessionTrigger = "schedule" | "manual" | "event" | "retry";

/**
 * Result returned from executeWorkflowSession.
 */
export interface SessionResult {
  status: "completed" | "suspended" | "failed" | "maintenance" | "transient";
  error?: string;
  errorType?: string;
  reason?: string;
  sessionId?: string;
  /** Handler run that triggered maintenance (new-format only) */
  handlerRunId?: string;
  /** Handler name that failed (new-format only) */
  handlerName?: string;
  /** Connector service ID from auth error (e.g. "gmail", "gdrive") */
  serviceId?: string;
  /** Connector account ID from auth error (e.g. "user@gmail.com") */
  accountId?: string;
}

/**
 * Configuration for session execution.
 */
export interface SessionConfig {
  /** Maximum number of consumer iterations before stopping. Default: 100 */
  maxIterations?: number;
}

// ============================================================================
// Session State Management
// ============================================================================

// completeSession, failSession, finishSessionForMaintenance,
// finishSessionForTransient, suspendSession, handleApprovalNeeded — removed.
//
// After Topic 2, EMM.updateHandlerRunStatus() atomically handles session
// finalization for all failure/pause paths. Success-path finalization uses
// EMM.finishSession(). Notification creation moved to workflow-scheduler's
// postSessionResult().

/**
 * Finalize a session that failed outside handler execution (e.g., config parse error).
 * For errors during handler execution, EMM already finalized the session atomically.
 */
async function finishSessionOnOuterError(
  api: KeepDbApi,
  session: ScriptRun,
  error: string,
  errorType: string = "logic"
): Promise<void> {
  const runs = await api.handlerRunStore.getBySession(session.id);
  const totalCost = runs.reduce((sum, run) => sum + (run.cost || 0), 0);

  await api.scriptStore.finishScriptRun(
    session.id,
    new Date().toISOString(),
    "failed",
    error,
    "",
    errorType,
    totalCost
  );
  log(`Session ${session.id} finished (outer error): ${error}`);
}

// ============================================================================
// Handler Result → Session Result Mapping
// ============================================================================

/**
 * Map a handler result to a session result.
 * Returns null if the handler committed (session should continue).
 *
 * After Topic 2, EMM.updateHandlerRunStatus() already atomically finalized
 * the session for all failure/pause paths. This function just maps the
 * handler status to the appropriate SessionResult — no DB calls needed.
 */
function mapHandlerResultToSession(
  result: HandlerResult,
  sessionId: string,
  handlerRunId: string,
  handlerName: string,
): SessionResult | null {
  if (result.status === "failed:logic") {
    return {
      status: "maintenance",
      error: result.error || "Handler failed",
      errorType: result.errorType || "logic",
      sessionId,
      handlerRunId,
      handlerName,
    };
  }

  if (isFailedStatus(result.status)) {
    return {
      status: "failed",
      error: result.error || "Handler failed",
      errorType: result.errorType,
      sessionId,
      serviceId: result.serviceId,
      accountId: result.accountId,
    };
  }

  if (result.status === "paused:transient") {
    return {
      status: "transient",
      error: result.error || "Transient error",
      sessionId,
      handlerRunId,
      handlerName,
    };
  }

  if (isPausedStatus(result.status)) {
    return {
      status: "suspended",
      reason: result.error || "handler_suspended",
      sessionId,
      serviceId: result.serviceId,
      accountId: result.accountId,
    };
  }

  // committed or other non-terminal — session should continue
  return null;
}

// ============================================================================
// Work Detection
// ============================================================================

/**
 * Find a consumer with pending work to process.
 *
 * When schedulerState is provided, uses in-memory dirty flags (zero DB queries).
 * When not provided, falls back to DB queries for backward compatibility.
 *
 * Returns the first consumer that has:
 * - dirty=true (new events since last commit), OR
 * - A due wakeAt time (for time-based scheduling)
 */
export async function findConsumerWithPendingWork(
  api: KeepDbApi,
  workflow: Workflow,
  schedulerState?: SchedulerStateManager
): Promise<{ name: string; reason: "events" | "wakeAt" } | null> {
  if (!workflow.handler_config) {
    return null;
  }

  let config: WorkflowConfig;
  try {
    config = JSON.parse(workflow.handler_config) as WorkflowConfig;
  } catch {
    return null;
  }

  if (!config.consumers) {
    return null;
  }

  if (schedulerState) {
    // In-memory path: check dirty consumers (event-driven)
    for (const consumerName of Object.keys(config.consumers)) {
      if (schedulerState.isConsumerDirty(workflow.id, consumerName)) {
        log(`Found consumer ${consumerName} dirty (in-memory)`);
        return { name: consumerName, reason: "events" };
      }
    }

    // In-memory path: check due wakeAt (time-driven)
    const dueConsumers = schedulerState.getConsumersWithDueWakeAt(workflow.id);
    for (const consumerName of dueConsumers) {
      if (config.consumers[consumerName]) {
        log(`Found consumer ${consumerName} with due wakeAt (in-memory)`);
        return { name: consumerName, reason: "wakeAt" };
      }
    }

    return null;
  }

  // Fallback: DB queries when no schedulerState (backward compatibility)
  for (const [consumerName, consumerConfig] of Object.entries(config.consumers)) {
    for (const topicName of consumerConfig.subscribe || []) {
      const pendingCount = await api.eventStore.countPending(
        workflow.id,
        topicName
      );
      if (pendingCount > 0) {
        log(`Found consumer ${consumerName} with work in topic ${topicName} (${pendingCount} pending)`);
        return { name: consumerName, reason: "events" };
      }
    }
  }

  const dueConsumers = await api.handlerStateStore.getConsumersWithDueWakeAt(workflow.id);
  if (dueConsumers.length > 0) {
    for (const consumerName of dueConsumers) {
      if (config.consumers[consumerName]) {
        log(`Found consumer ${consumerName} with due wakeAt`);
        return { name: consumerName, reason: "wakeAt" };
      }
    }
  }

  return null;
}

// ============================================================================
// Cost Aggregation
// ============================================================================

/**
 * Get the total cost of a session by aggregating handler run costs.
 */
export async function getSessionCost(
  api: KeepDbApi,
  sessionId: string
): Promise<number> {
  const runs = await api.handlerRunStore.getBySession(sessionId);
  return runs.reduce((sum, run) => sum + (run.cost || 0), 0);
}

// ============================================================================
// Session Execution
// ============================================================================

/**
 * Execute a workflow session.
 *
 * This is the main entry point for running a workflow. It:
 * 1. Creates a session container (script_run)
 * 2. Runs all producers (if scheduled/manual trigger)
 * 3. Loops consumers while work exists (with budget limit)
 * 4. Completes or fails the session
 *
 * @param workflow - The workflow to execute
 * @param trigger - What triggered this session
 * @param context - Execution context with API and optional resources
 * @param config - Optional session configuration
 * @returns The session result
 */
export async function executeWorkflowSession(
  workflow: Workflow,
  trigger: SessionTrigger,
  context: HandlerExecutionContext,
  config: SessionConfig = {}
): Promise<SessionResult> {
  const { api } = context;
  const maxIterations = config.maxIterations ?? 100;

  if (!workflow.active_script_id) {
    return {
      status: "failed",
      error: `Workflow ${workflow.id} has no active script`,
    };
  }

  // Create session container
  const sessionId = bytesToHex(randomBytes(16));
  await api.scriptStore.startScriptRun(
    sessionId,
    workflow.active_script_id,
    new Date().toISOString(),
    workflow.id,
    trigger, // Store trigger type in 'type' field
    "", // retry_of
    0 // retry_count
  );

  log(`Started session ${sessionId} for workflow ${workflow.id} (trigger: ${trigger})`);

  // Create a minimal ScriptRun object for helper functions
  const session: ScriptRun = {
    id: sessionId,
    script_id: workflow.active_script_id,
    start_timestamp: new Date().toISOString(),
    end_timestamp: "",
    error: "",
    error_type: "",
    result: "",
    logs: "",
    workflow_id: workflow.id,
    type: trigger,
    retry_of: "",
    retry_count: 0,
    cost: 0,
  };

  try {
    // 1. Run producers (if scheduled/manual trigger)
    if (trigger === "schedule" || trigger === "manual") {
      let handlerConfig: WorkflowConfig | null = null;
      if (workflow.handler_config) {
        try {
          handlerConfig = JSON.parse(workflow.handler_config) as WorkflowConfig;
        } catch {
          await finishSessionOnOuterError(api, session, "Invalid handler_config JSON", "logic");
          return {
            status: "failed",
            error: "Invalid handler_config JSON",
            sessionId,
          };
        }
      }

      if (handlerConfig?.producers) {
        // For schedule triggers, only run producers that are due (exec-13)
        let producersToRun: string[];
        if (trigger === "schedule") {
          const dueProducers = await api.producerScheduleStore.getDueProducers(workflow.id);
          producersToRun = dueProducers.map(p => p.producer_name);
          log(`Schedule trigger: ${producersToRun.length} due producers for workflow ${workflow.id}`);
          // Fall back to all producers if no per-producer schedules exist yet
          if (producersToRun.length === 0) {
            producersToRun = Object.keys(handlerConfig.producers);
          }
        } else {
          producersToRun = Object.keys(handlerConfig.producers);
        }

        for (const producerName of producersToRun) {
          log(`Running producer ${producerName}`);

          // Create handler run
          const handlerRun = await api.handlerRunStore.create({
            script_run_id: sessionId,
            workflow_id: workflow.id,
            handler_type: "producer",
            handler_name: producerName,
          });

          // Execute handler
          const result = await executeHandler(handlerRun.id, context);

          // Per exec-09: check status instead of phase for failure/paused detection.
          // EMM already finalized session atomically inside executeHandler —
          // just map the handler result to a SessionResult.
          const sessionResult = mapHandlerResultToSession(result, sessionId, handlerRun.id, producerName);
          if (sessionResult) return sessionResult;
        }
      }
    }

    // 2. Loop consumers while work exists (with budget)
    let iterations = 0;

    while (iterations < maxIterations) {
      const consumer = await findConsumerWithPendingWork(api, workflow, context.schedulerState);
      if (!consumer) {
        log(`No more work found for workflow ${workflow.id}`);
        break;
      }

      log(`Running consumer ${consumer.name} (iteration ${iterations + 1})`);

      // Create handler run
      const handlerRun = await api.handlerRunStore.create({
        script_run_id: sessionId,
        workflow_id: workflow.id,
        handler_type: "consumer",
        handler_name: consumer.name,
      });

      // Execute handler
      const result = await executeHandler(handlerRun.id, context);
      iterations++;

      // Per exec-09: check status instead of phase for failure/paused detection.
      // EMM already finalized session atomically — just map to SessionResult.
      const sessionResult = mapHandlerResultToSession(result, sessionId, handlerRun.id, consumer.name);
      if (sessionResult) return sessionResult;
      // committed = continue checking for more work
    }

    if (iterations >= maxIterations) {
      log(`Session ${sessionId} hit budget limit (${maxIterations} iterations)`);
    }

    // 3. Complete session via EMM
    await context.emm.finishSession(sessionId);
    return { status: "completed", sessionId };
  } catch (error) {
    // Error outside handler execution (e.g., config parse, workflow not found).
    // No handler run involved, so EMM wasn't called — finalize session directly.
    const { status: runStatus, error: classifiedError } = getRunStatusForError(error, "session-orchestration");
    await finishSessionOnOuterError(api, session, classifiedError.message, classifiedError.type);

    if (runStatus === "failed:logic") {
      return {
        status: "maintenance",
        error: classifiedError.message,
        errorType: classifiedError.type,
        sessionId,
      };
    }

    return {
      status: "failed",
      error: classifiedError.message,
      sessionId,
    };
  }
}

// ============================================================================
// Session Recovery
// ============================================================================

/**
 * Continue an interrupted session.
 * Resumes the consumer loop from where it left off.
 */
async function continueSession(
  api: KeepDbApi,
  workflow: Workflow,
  session: ScriptRun,
  context: HandlerExecutionContext,
  maxIterations: number = 100
): Promise<SessionResult> {
  // Get current iteration count from handler runs
  const runs = await api.handlerRunStore.getBySession(session.id);
  let iterations = runs.length;

  log(`Continuing session ${session.id} from iteration ${iterations}`);

  while (iterations < maxIterations) {
    const consumer = await findConsumerWithPendingWork(api, workflow, context.schedulerState);
    if (!consumer) {
      log(`No more work found for session ${session.id}`);
      break;
    }

    log(`Continuing with consumer ${consumer.name} (iteration ${iterations + 1})`);

    const handlerRun = await api.handlerRunStore.create({
      script_run_id: session.id,
      workflow_id: workflow.id,
      handler_type: "consumer",
      handler_name: consumer.name,
    });

    const result = await executeHandler(handlerRun.id, context);
    iterations++;

    // EMM already finalized session atomically — just map to SessionResult.
    const sessionResult = mapHandlerResultToSession(result, session.id, handlerRun.id, consumer.name);
    if (sessionResult) return sessionResult;
  }

  await context.emm.finishSession(session.id);
  return { status: "completed", sessionId: session.id };
}

/**
 * Resume incomplete sessions on app restart.
 *
 * Unified crash recovery: marks crashed runs, closes their sessions, and sets
 * pending_retry_run_id so the scheduler creates new retry sessions.
 *
 * 1. Finds all workflows with incomplete handler runs (status='active')
 * 2. Skips paused/error workflows (they need user attention)
 * 3. For each incomplete run, applies the mutation-boundary invariant:
 *    a. In-flight mutation → mark indeterminate + set pending_retry_run_id + pause workflow
 *    b. Post-mutation (mutated/emitting) → mark crashed + set pending_retry_run_id
 *    c. Pre-mutation (preparing/prepared/mutating with failed) → mark crashed, NO pending_retry
 * 4. Return — scheduler handles retry via retryWorkflowSession()
 *
 * Note: createRetryRun() is NOT removed from handler-state-machine.ts — it's
 * still used by indeterminate-resolution.ts (out of scope).
 */
export async function resumeIncompleteSessions(
  context: HandlerExecutionContext
): Promise<void> {
  const { api } = context;

  // Find workflows with incomplete handler runs
  const workflowIds = await api.handlerRunStore.getWorkflowsWithIncompleteRuns();
  log(`Found ${workflowIds.length} workflows with incomplete runs`);

  for (const workflowId of workflowIds) {
    const workflow = await api.scriptStore.getWorkflow(workflowId);
    if (!workflow) {
      log(`Workflow ${workflowId} not found, skipping`);
      continue;
    }

    // Skip paused/error workflows - they need user attention
    if (workflow.status !== "active") {
      log(`Workflow ${workflowId} is ${workflow.status}, skipping`);
      continue;
    }

    // Get incomplete handler runs (status='active')
    const incompleteRuns = await api.handlerRunStore.getIncomplete(workflowId);
    log(`Found ${incompleteRuns.length} incomplete runs for workflow ${workflowId}`);

    for (const run of incompleteRuns) {
      log(`Processing crashed run ${run.id} (${run.handler_type}:${run.handler_name} in phase ${run.phase})`);

      // Determine if this run crossed the mutation boundary.
      // The critical boundary is mutation application:
      // - Pre-mutation (preparing, prepared, mutating with failed/pending/no mutation):
      //   fresh start is fine, no pending_retry needed, events can be released.
      // - Indeterminate (mutating with in_flight/indeterminate/needs_reconcile/applied mutation):
      //   must set pending_retry, events must NOT be released.
      // - Post-mutation (mutated, emitting):
      //   must set pending_retry, events must NOT be released, retry copies results.

      const needsPendingRetry = await (async () => {
        if (run.phase === "mutated" || run.phase === "emitting") return true;
        if (run.phase === "mutating") {
          const mutation = await api.mutationStore.getByHandlerRunId(run.id);
          if (mutation && mutation.status !== "failed" && mutation.status !== "pending") return true;
        }
        return false;
      })();

      // Path A: Indeterminate mutation (mutating + in_flight)
      if (run.phase === "mutating") {
        const mutation = await api.mutationStore.getByHandlerRunId(run.id);
        if (mutation?.status === "in_flight") {
          // Uncertain outcome - mark indeterminate, set pending_retry, pause workflow
          log(`Run ${run.id} has in_flight mutation - marking indeterminate`);
          await api.db.db.tx(async (tx: DBInterface) => {
            await api.mutationStore.markIndeterminate(
              mutation.id,
              "Mutation was in_flight at restart - outcome uncertain",
              tx
            );
            await api.handlerRunStore.update(run.id, {
              status: "paused:reconciliation",
              error: "Mutation outcome uncertain - requires user verification",
              end_timestamp: new Date().toISOString(),
            }, tx);
            await api.scriptStore.updateWorkflowFields(workflowId, {
              status: "paused",
              pending_retry_run_id: run.id,
            }, tx);
          });
          log(`Workflow ${workflowId} paused due to indeterminate mutation, pending_retry_run_id set`);
          continue;
        }
      }

      // Path B & C: Mark crashed + close session
      // Only set pending_retry_run_id for post-mutation phases (mutated/emitting)
      // or mutating with non-failed mutation.
      try {
        await api.db.db.tx(async (tx: DBInterface) => {
          // Mark run as crashed
          await api.handlerRunStore.update(
            run.id,
            {
              status: "crashed",
              error: "Process crashed during execution",
              end_timestamp: new Date().toISOString(),
            },
            tx
          );

          // Close the session
          const session = await api.scriptStore.getScriptRun(run.script_run_id);
          if (session && !session.end_timestamp) {
            await api.scriptStore.finishScriptRun(
              session.id,
              new Date().toISOString(),
              "failed",
              "Process crashed during execution",
              "",
              "crash",
              0,
              tx
            );
          }

          // Only set pending_retry_run_id when mutation boundary was crossed
          if (needsPendingRetry) {
            await api.scriptStore.updateWorkflowFields(workflowId, {
              pending_retry_run_id: run.id,
            }, tx);
          }
        });

        log(`Marked run ${run.id} as crashed${needsPendingRetry ? ', set pending_retry_run_id' : ', no pending_retry (pre-mutation)'}`);
      } catch (error) {
        log(`Failed to process crashed run ${run.id}: ${error}`);
        // Best-effort: mark the run as crashed even if the tx failed
        try {
          await api.handlerRunStore.update(run.id, {
            status: "crashed",
            error: `Crash recovery failed: ${error}`,
            end_timestamp: new Date().toISOString(),
          });
        } catch {
          log(`Failed to even mark run ${run.id} as crashed`);
        }
      }
    }
  }
}

// ============================================================================
// Unified Retry Recovery
// ============================================================================

/**
 * Execute a retry session for a workflow with a pending retry.
 *
 * Core retry logic used by ALL recovery paths (crash, transient, fix).
 * Atomically creates the retry run AND clears pending_retry_run_id in one
 * transaction for crash safety.
 *
 * After the retry run executes, continues the consumer loop if the run committed.
 *
 * @param workflow - The workflow to retry
 * @param failedHandlerRunId - The handler run ID to retry
 * @param context - Execution context
 * @returns The session result
 */
export async function retryWorkflowSession(
  workflow: Workflow,
  failedHandlerRunId: string,
  context: HandlerExecutionContext
): Promise<SessionResult> {
  const { api } = context;

  // 1. Load failed handler run
  const failedRun = await api.handlerRunStore.get(failedHandlerRunId);
  if (!failedRun) {
    log(`retryWorkflowSession: failed run ${failedHandlerRunId} not found, clearing and falling back`);
    await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
    return executeWorkflowSession(workflow, "event", context);
  }

  // 2. Check if already retried (race: two recovery paths)
  const existingRetries = await api.handlerRunStore.getRetriesOf(failedHandlerRunId);
  if (existingRetries.length > 0) {
    log(`retryWorkflowSession: run ${failedHandlerRunId} already retried, clearing and falling back`);
    await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
    return executeWorkflowSession(workflow, "event", context);
  }

  // 3. Compute phase reset
  const startPhase = getStartPhaseForRetry(failedRun.phase, failedRun.handler_type);
  const copyResults = shouldCopyResults(failedRun.phase);

  log(
    `retryWorkflowSession: retrying run ${failedRun.id} (${failedRun.handler_name}), ` +
    `startPhase=${startPhase}, copyResults=${copyResults}`
  );

  // 4. Create new session
  const sessionId = bytesToHex(randomBytes(16));
  await api.scriptStore.startScriptRun(
    sessionId,
    workflow.active_script_id,
    new Date().toISOString(),
    workflow.id,
    "retry",
    "",
    0
  );

  const session: ScriptRun = {
    id: sessionId,
    script_id: workflow.active_script_id,
    start_timestamp: new Date().toISOString(),
    end_timestamp: "",
    error: "",
    error_type: "",
    result: "",
    logs: "",
    workflow_id: workflow.id,
    type: "retry",
    retry_of: "",
    retry_count: 0,
    cost: 0,
  };

  try {
    // 5. ATOMIC TRANSACTION: create retry run + clear pending_retry_run_id + release events if needed
    const result: { newRun: HandlerRun | null } = { newRun: null };

    await api.db.db.tx(async (tx: DBInterface) => {
      // a. Create retry handler run
      result.newRun = await api.handlerRunStore.create(
        {
          script_run_id: sessionId,
          workflow_id: workflow.id,
          handler_type: failedRun.handler_type,
          handler_name: failedRun.handler_name,
          retry_of: failedRun.id,
          phase: startPhase,
          prepare_result: copyResults ? failedRun.prepare_result : undefined,
          input_state: failedRun.input_state,
        },
        tx
      );

      // b. Clear pending_retry_run_id
      await api.scriptStore.updateWorkflowFields(workflow.id, {
        pending_retry_run_id: '',
      }, tx);

      // c. Release reserved events for consumer pre-mutation resets
      // Only consumers reserve events (during preparing→prepared), producers never do
      if (failedRun.handler_type === "consumer" && !copyResults) {
        await api.eventStore.releaseEvents(failedRun.id, tx);
      }
    });

    if (!result.newRun) {
      throw new Error("Failed to create retry run in transaction");
    }

    const retryRun = result.newRun;
    log(`Created retry run ${retryRun.id} in new session ${sessionId}`);

    // 6. Execute the retry run
    const handlerResult = await executeHandler(retryRun.id, context);

    // 7. Handle result — EMM already finalized session atomically
    const sessionResult = mapHandlerResultToSession(handlerResult, sessionId, retryRun.id, failedRun.handler_name);
    if (sessionResult) return sessionResult;

    // 8. If committed, continue consumer loop
    const continueResult = await continueSession(api, workflow, session, context);
    return continueResult;
  } catch (error) {
    // Error outside handler execution — finalize session directly
    const { status: runStatus, error: classifiedError } = getRunStatusForError(error, "retryWorkflowSession");
    await finishSessionOnOuterError(api, session, classifiedError.message, classifiedError.type);

    if (runStatus === "failed:logic") {
      return {
        status: "maintenance",
        error: classifiedError.message,
        errorType: classifiedError.type,
        sessionId,
      };
    }

    return {
      status: "failed",
      error: classifiedError.message,
      sessionId,
    };
  }
}

// ============================================================================
// Single-Threaded Constraint
// ============================================================================

/**
 * Check if a workflow can start a new session.
 * Enforces the single-threaded constraint: only one session can run at a time.
 *
 * @returns true if a new session can start, false if one is already active
 */
export async function canStartSession(
  api: KeepDbApi,
  workflowId: string
): Promise<boolean> {
  const hasActiveRun = await api.handlerRunStore.hasActiveRun(workflowId);
  return !hasActiveRun;
}

/**
 * Execute a workflow session if no other session is active.
 * This is the safe entry point that enforces single-threaded execution.
 *
 * @returns The session result, or null if another session is active
 */
export async function executeWorkflowSessionIfIdle(
  workflow: Workflow,
  trigger: SessionTrigger,
  context: HandlerExecutionContext,
  config: SessionConfig = {}
): Promise<SessionResult | null> {
  const canStart = await canStartSession(context.api, workflow.id);
  if (!canStart) {
    log(`Skipping session for workflow ${workflow.id} - another session is active`);
    return null;
  }

  return executeWorkflowSession(workflow, trigger, context, config);
}
