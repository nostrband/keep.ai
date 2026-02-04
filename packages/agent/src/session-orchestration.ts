/**
 * Session Orchestration (exec-07)
 *
 * Session-based workflow execution using `script_runs` as the session container.
 * A session runs producers, then loops consumers until work is done or budget
 * is exhausted.
 *
 * See specs/exec-07-session-orchestration.md for design details.
 */

import { KeepDbApi, Workflow, ScriptRun, HandlerRun, isFailedStatus, isPausedStatus } from "@app/db";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import {
  executeHandler,
  HandlerExecutionContext,
  HandlerResult,
  createRetryRun,
} from "./handler-state-machine";
import { WorkflowConfig } from "./workflow-validator";
import { ensureClassified } from "./errors";
import debug from "debug";

const log = debug("session-orchestration");

// ============================================================================
// Types
// ============================================================================

/**
 * Session trigger type.
 */
export type SessionTrigger = "schedule" | "manual" | "event";

/**
 * Result returned from executeWorkflowSession.
 */
export interface SessionResult {
  status: "completed" | "suspended" | "failed";
  error?: string;
  reason?: string;
  sessionId?: string;
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

/**
 * Complete a session successfully.
 * Aggregates cost from all handler runs.
 */
async function completeSession(api: KeepDbApi, session: ScriptRun): Promise<void> {
  // Aggregate cost from handler runs
  const runs = await api.handlerRunStore.getBySession(session.id);
  const totalCost = runs.reduce((sum, run) => sum + (run.cost || 0), 0);

  await api.scriptStore.finishScriptRun(
    session.id,
    new Date().toISOString(),
    "completed",
    "", // no error
    "", // no logs (logs are per handler run)
    "", // no error type
    totalCost
  );
  log(`Session ${session.id} completed with cost ${totalCost}`);
}

/**
 * Fail a session with an error.
 * Updates workflow status to 'error'.
 */
async function failSession(
  api: KeepDbApi,
  session: ScriptRun,
  error: string,
  errorType: string = "logic"
): Promise<void> {
  // Aggregate cost from handler runs
  const runs = await api.handlerRunStore.getBySession(session.id);
  const totalCost = runs.reduce((sum, run) => sum + (run.cost || 0), 0);

  await api.scriptStore.finishScriptRun(
    session.id,
    new Date().toISOString(),
    "failed",
    error,
    "", // no logs
    errorType,
    totalCost
  );

  // Pause workflow on failure
  await api.scriptStore.updateWorkflowFields(session.workflow_id, {
    status: "error",
  });
  log(`Session ${session.id} failed: ${error}`);
}

/**
 * Suspend a session with a reason.
 * Updates workflow status to 'paused'.
 */
async function suspendSession(
  api: KeepDbApi,
  session: ScriptRun,
  reason: string
): Promise<void> {
  // Aggregate cost from handler runs
  const runs = await api.handlerRunStore.getBySession(session.id);
  const totalCost = runs.reduce((sum, run) => sum + (run.cost || 0), 0);

  await api.scriptStore.finishScriptRun(
    session.id,
    new Date().toISOString(),
    "suspended",
    reason,
    "", // no logs
    "", // no error type
    totalCost
  );

  // Pause workflow on suspension
  await api.scriptStore.updateWorkflowFields(session.workflow_id, {
    status: "paused",
  });
  log(`Session ${session.id} suspended: ${reason}`);
}

// ============================================================================
// Work Detection
// ============================================================================

/**
 * Find a consumer with pending work to process.
 * Returns the first consumer that has pending events in any of its subscribed topics.
 */
async function findConsumerWithPendingWork(
  api: KeepDbApi,
  workflow: Workflow
): Promise<{ name: string } | null> {
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

  for (const [consumerName, consumerConfig] of Object.entries(config.consumers)) {
    // Check if any subscribed topic has pending events
    for (const topicName of consumerConfig.subscribe || []) {
      const pendingCount = await api.eventStore.countPending(
        workflow.id,
        topicName
      );
      if (pendingCount > 0) {
        log(`Found consumer ${consumerName} with work in topic ${topicName} (${pendingCount} pending)`);
        return { name: consumerName };
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
          await failSession(api, session, "Invalid handler_config JSON", "logic");
          return {
            status: "failed",
            error: "Invalid handler_config JSON",
            sessionId,
          };
        }
      }

      if (handlerConfig?.producers) {
        for (const producerName of Object.keys(handlerConfig.producers)) {
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

          // Per exec-09: check status instead of phase for failure/paused detection
          if (isFailedStatus(result.status)) {
            await failSession(
              api,
              session,
              result.error || "Producer failed",
              result.errorType || "logic"
            );
            return {
              status: "failed",
              error: result.error || "Producer failed",
              sessionId,
            };
          }

          if (isPausedStatus(result.status)) {
            await suspendSession(
              api,
              session,
              result.error || "Producer suspended"
            );
            return {
              status: "suspended",
              reason: result.error || "Producer suspended",
              sessionId,
            };
          }
        }
      }
    }

    // 2. Loop consumers while work exists (with budget)
    let iterations = 0;

    while (iterations < maxIterations) {
      const consumer = await findConsumerWithPendingWork(api, workflow);
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

      // Per exec-09: check status instead of phase for failure/paused detection
      if (isFailedStatus(result.status)) {
        await failSession(
          api,
          session,
          result.error || "Consumer failed",
          result.errorType || "logic"
        );
        return {
          status: "failed",
          error: result.error || "Consumer failed",
          sessionId,
        };
      }

      if (isPausedStatus(result.status)) {
        await suspendSession(
          api,
          session,
          result.error || "handler_suspended"
        );
        return {
          status: "suspended",
          reason: result.error || "handler_suspended",
          sessionId,
        };
      }
      // committed = continue checking for more work
    }

    if (iterations >= maxIterations) {
      log(`Session ${sessionId} hit budget limit (${maxIterations} iterations)`);
    }

    // 3. Complete session
    await completeSession(api, session);
    return { status: "completed", sessionId };
  } catch (error) {
    const classifiedError = ensureClassified(error, "session-orchestration");
    await failSession(api, session, classifiedError.message, classifiedError.type);
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
    const consumer = await findConsumerWithPendingWork(api, workflow);
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

    // Per exec-09: check status instead of phase for failure/paused detection
    if (isFailedStatus(result.status)) {
      await failSession(
        api,
        session,
        result.error || "Consumer failed",
        result.errorType || "logic"
      );
      return {
        status: "failed",
        error: result.error || "Consumer failed",
        sessionId: session.id,
      };
    }

    if (isPausedStatus(result.status)) {
      await suspendSession(api, session, result.error || "handler_suspended");
      return {
        status: "suspended",
        reason: result.error || "handler_suspended",
        sessionId: session.id,
      };
    }
  }

  await completeSession(api, session);
  return { status: "completed", sessionId: session.id };
}

/**
 * Resume incomplete sessions on app restart.
 *
 * Per exec-10 spec, this function:
 * 1. Finds all workflows with incomplete handler runs (status='active')
 * 2. Skips paused/error workflows (they need user attention)
 * 3. For each incomplete run:
 *    a. Mark as 'crashed'
 *    b. Check for indeterminate mutations (don't auto-retry those)
 *    c. Create recovery run with retry_of pointing to crashed run
 * 4. Execute the recovery runs
 * 5. Continue sessions that were interrupted
 *
 * @param api - Database API
 * @param context - Execution context
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

    // Track recovery runs to execute
    const recoveryRuns: HandlerRun[] = [];

    for (const run of incompleteRuns) {
      log(`Processing crashed run ${run.id} (${run.handler_type}:${run.handler_name} in phase ${run.phase})`);

      // Check for in-flight mutation (indeterminate state)
      if (run.phase === "mutating") {
        const mutation = await api.mutationStore.getByHandlerRunId(run.id);
        if (mutation?.status === "in_flight") {
          // Uncertain outcome - mark indeterminate, don't auto-retry
          log(`Run ${run.id} has in_flight mutation - marking indeterminate, no auto-retry`);
          await api.mutationStore.markIndeterminate(
            mutation.id,
            "Mutation was in_flight at restart - outcome uncertain"
          );
          // Mark run as crashed and paused for reconciliation
          await api.handlerRunStore.update(run.id, {
            status: "paused:reconciliation",
            error: "Mutation outcome uncertain - requires user verification",
            end_timestamp: new Date().toISOString(),
          });
          // Don't create retry run - needs user reconciliation
          continue;
        }
      }

      // Create recovery run with retry_of linking
      try {
        const recoveryRun = await createRetryRun({
          previousRun: run,
          previousRunStatus: "crashed",
          reason: "crashed_recovery",
          api,
        });
        recoveryRuns.push(recoveryRun);
        log(`Created recovery run ${recoveryRun.id} for crashed run ${run.id}`);
      } catch (error) {
        log(`Failed to create recovery run for ${run.id}: ${error}`);
        // Mark the run as crashed anyway
        await api.handlerRunStore.update(run.id, {
          status: "crashed",
          error: `Failed to create recovery run: ${error}`,
          end_timestamp: new Date().toISOString(),
        });
      }
    }

    // Execute recovery runs
    for (const recoveryRun of recoveryRuns) {
      log(`Executing recovery run ${recoveryRun.id} (${recoveryRun.handler_type}:${recoveryRun.handler_name})`);
      await executeHandler(recoveryRun.id, context);
    }

    // After handling crashed runs, check if session should continue
    if (recoveryRuns.length > 0) {
      const firstRun = recoveryRuns[0];
      const session = await api.scriptStore.getScriptRun(firstRun.script_run_id);

      if (session && !session.end_timestamp) {
        // Session was interrupted, continue it
        log(`Continuing interrupted session ${session.id}`);
        await continueSession(api, workflow, session, context);
      }
    }
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
