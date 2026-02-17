/**
 * Handler State Machine (exec-06)
 *
 * Unified state machine for handler execution. Same code handles normal
 * execution and restart recovery. Each phase transition is persisted to
 * the database, enabling checkpoint-based recovery.
 *
 * See specs/exec-06-handler-state-machine.md for design details.
 */

import {
  KeepDbApi,
  HandlerRun,
  HandlerRunPhase,
  HandlerType,
  HandlerErrorType,
  RunStatus,
  isTerminalStatus,
  isPausedStatus,
  isFailedStatus,
  Mutation,
  Workflow,
  DBInterface,
} from "@app/db";
import {
  AuthError,
  ClassifiedError,
  LogicError,
  InternalError,
  ErrorType,
} from "./errors";
import { getRunStatusForError, isDefiniteFailure } from "./failure-handling";
import { initSandbox, Sandbox, EvalContext } from "./sandbox/sandbox";
import { ToolWrapper, ExecutionPhase } from "./sandbox/tool-wrapper";
import { createWorkflowTools } from "./sandbox/tool-lists";
import { WorkflowConfig } from "./workflow-validator";
import { computeNextRunTime } from "./schedule-utils";
import {
  ReconciliationRegistry,
  type MutationParams,
} from "./reconciliation";
import type { ConnectionManager } from "@app/connectors";
import type { SchedulerStateManager } from "./scheduler-state";
import debug from "debug";

const log = debug("handler-state-machine");

// ============================================================================
// Types
// ============================================================================

/**
 * Result returned from executeHandler.
 */
export interface HandlerResult {
  phase: HandlerRunPhase;
  status: RunStatus;
  error?: string;
  errorType?: HandlerErrorType | "";
  /** Connector service ID from the error (e.g. "gmail", "gdrive") */
  serviceId?: string;
  /** Connector account ID from the error (e.g. "user@gmail.com") */
  accountId?: string;
}

/**
 * UI metadata from prepare result (exec-15).
 */
export interface PrepareResultUI {
  /** User-facing title describing what the mutation will do */
  title?: string;
}

/**
 * Prepare result from consumer prepare phase.
 */
export interface PrepareResult {
  /** Event reservations: array of { topic, ids } */
  reservations: Array<{ topic: string; ids: string[] }>;
  /** Optional data extracted during prepare */
  data?: unknown;
  /** Optional UI metadata for the mutation (exec-15) */
  ui?: PrepareResultUI;
  /**
   * Optional wakeAt time for time-based scheduling (exec-11).
   * ISO 8601 datetime string (e.g., "2024-01-16T09:00:00Z").
   * Host enforces: 30s minimum, 24h maximum from now.
   */
  wakeAt?: string;
}

/**
 * Context for handler execution.
 */
export interface HandlerExecutionContext {
  api: KeepDbApi;
  connectionManager?: ConnectionManager;
  userPath?: string;
  abortController?: AbortController;
  schedulerState?: SchedulerStateManager;
  /** Service ID from the last classified error (set by failRun for AuthError) */
  errorServiceId?: string;
  /** Account ID from the last classified error (set by failRun for AuthError) */
  errorAccountId?: string;
}

// ============================================================================
// Terminal State Check
// ============================================================================

/**
 * Check if a run is terminal (no more execution possible).
 *
 * Per exec-09 spec, we now check status instead of phase.
 * Terminal statuses: committed, failed:*, crashed
 * Paused statuses are NOT terminal (can be resumed).
 *
 * @deprecated For backwards compatibility. Use isTerminalStatus(run.status) instead.
 */
export function isTerminal(phase: HandlerRunPhase): boolean {
  // Backwards compatibility with old phase-based logic
  return ["committed", "suspended", "failed"].includes(phase);
}

/**
 * Check if a handler run is done executing (terminal or paused).
 *
 * Returns true if the run is in a state where the state machine should stop.
 * This includes both terminal states (committed, failed, crashed) and
 * paused states (paused:transient, paused:approval, paused:reconciliation).
 */
export function isRunDone(run: HandlerRun): boolean {
  return isTerminalStatus(run.status) || isPausedStatus(run.status);
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Map ClassifiedError type to HandlerErrorType.
 */
function errorTypeToHandlerErrorType(type: ErrorType): HandlerErrorType {
  switch (type) {
    case "auth":
      return "auth";
    case "permission":
      return "permission";
    case "network":
      return "network";
    case "logic":
      return "logic";
    case "internal":
    case "api_key":
    case "balance":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * Map ClassifiedError type to RunStatus.
 *
 * Per exec-12 spec:
 * - auth/permission → paused:approval (needs user action)
 * - network → paused:transient (will auto-retry)
 * - logic → failed:logic (auto-fix eligible)
 * - internal → failed:internal (bug in our code)
 */
function errorTypeToRunStatus(type: ErrorType): RunStatus {
  switch (type) {
    case "auth":
      return "paused:approval";
    case "permission":
      return "paused:approval";
    case "network":
      return "paused:transient";
    case "logic":
      return "failed:logic";
    case "internal":
    case "api_key":
    case "balance":
      return "failed:internal";
    default:
      return "failed:logic"; // Default to repair-eligible
  }
}

// isDefiniteFailure is now imported from failure-handling.ts

// ============================================================================
// Mutation Result for Next Phase (exec-14)
// ============================================================================

/**
 * Mutation result for the next phase.
 */
interface MutationResultForNext {
  status: "applied" | "skipped" | "none";
  result?: unknown;
}

/**
 * Get mutation result for the next phase.
 *
 * Per exec-14 spec, handles the mutation result based on status and resolution.
 * This is a local version to avoid circular imports with indeterminate-resolution.ts.
 */
function getMutationResultForNextPhase(mutation: Mutation | null): MutationResultForNext {
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
      // If failed and not skipped, shouldn't reach next phase
      // Return none to be safe (run should have been retried or terminated)
      return { status: "none" };

    case "pending":
      // Should not happen — mutations are now created directly in in_flight status.
      // If reached, treat as no mutation for safety.
      return { status: "none" };

    default:
      // in_flight, needs_reconcile, indeterminate - shouldn't reach next
      // Return none to be safe
      return { status: "none" };
  }
}

// ============================================================================
// Phase Reset Rules (exec-10)
// ============================================================================

/**
 * Phases where mutation has been applied.
 * After mutation is applied, retry runs must continue forward (not reset).
 */
type ConsumerPhase = Extract<
  HandlerRunPhase,
  "pending" | "preparing" | "prepared" | "mutating" | "mutated" | "emitting" | "committed"
>;

/**
 * Check if prepare_result and mutation_result should be copied to retry run.
 *
 * Per exec-10 spec: After mutation is applied, we must proceed forward
 * with existing results (can't re-do the mutation).
 *
 * @param phase - The phase at which the run failed
 * @returns true if results should be copied
 */
export function shouldCopyResults(phase: HandlerRunPhase): boolean {
  // After mutation is applied, we must proceed forward with existing results
  return phase === "mutated" || phase === "emitting";
}

/**
 * Get the starting phase for a retry run based on the previous run's phase.
 *
 * Per exec-10 spec:
 * - Producers always reset to "pending" (no mutation concept)
 * - Consumers before mutation (preparing, prepared, mutating with failed mutation): Start fresh from preparing
 * - Consumers after mutation (mutated, emitting): Resume from emitting with copied results
 *
 * @param previousPhase - The phase at which the previous run stopped
 * @param handlerType - The handler type (producer or consumer)
 * @returns The phase the retry run should start at
 */
export function getStartPhaseForRetry(previousPhase: HandlerRunPhase, handlerType: HandlerType): HandlerRunPhase {
  if (handlerType === "producer") {
    return "pending";
  }
  if (shouldCopyResults(previousPhase)) {
    // Can't reset - mutation happened, resume from emitting
    return "emitting";
  }
  // Before mutation - start fresh
  return "preparing";
}

/**
 * Reason for creating a retry run.
 */
export type RetryReason =
  | "transient" // Network/rate limit, auto-retry
  | "logic_fix" // Script error fixed, retry with new script
  | "crashed_recovery" // Host crashed, recovery run
  | "user_retry"; // User manually triggered retry

/**
 * Parameters for creating a retry run.
 */
export interface CreateRetryRunParams {
  /** The previous run that failed/crashed */
  previousRun: HandlerRun;
  /** The status to set on the previous run */
  previousRunStatus: RunStatus;
  /** Why we're creating a retry */
  reason: RetryReason;
  /** The API for database access */
  api: KeepDbApi;
}

/**
 * Create a new retry run linked to a previous failed run.
 *
 * Per exec-10 spec:
 * - Creates a new run with retry_of pointing to previous run
 * - Applies phase reset rules (fresh start vs continue from emitting)
 * - Copies prepare_result if mutation was applied
 * - Atomic: marks previous run + creates new run in single transaction
 *
 * @param params - The retry parameters
 * @returns The newly created retry run
 */
export async function createRetryRun(
  params: CreateRetryRunParams
): Promise<HandlerRun> {
  const { previousRun, previousRunStatus, reason, api } = params;

  const startPhase = getStartPhaseForRetry(previousRun.phase, previousRun.handler_type);
  const copyResults = shouldCopyResults(previousRun.phase);

  log(
    `Creating retry run for ${previousRun.id} (${previousRun.handler_name}): ` +
    `reason=${reason}, startPhase=${startPhase}, copyResults=${copyResults}`
  );

  // Atomic: update previous run status AND create new run
  // Use wrapper object to work around TypeScript closure narrowing limitations
  const result: { newRun: HandlerRun | null } = { newRun: null };

  await api.db.db.tx(async (tx: DBInterface) => {
    // 1. Mark previous run with final status
    await api.handlerRunStore.update(
      previousRun.id,
      {
        status: previousRunStatus,
        end_timestamp: new Date().toISOString(),
      },
      tx
    );

    // 2. Release reserved events for consumer pre-mutation resets
    // Only consumers reserve events (during preparing→prepared), producers never do
    if (previousRun.handler_type === "consumer" && !copyResults) {
      await api.eventStore.releaseEvents(previousRun.id, tx);
    }

    // 3. Create new retry run
    result.newRun = await api.handlerRunStore.create(
      {
        script_run_id: previousRun.script_run_id,
        workflow_id: previousRun.workflow_id,
        handler_type: previousRun.handler_type,
        handler_name: previousRun.handler_name,
        // Link to previous attempt
        retry_of: previousRun.id,
        // Phase reset or continue from emitting
        phase: startPhase,
        // Copy results if mutation was applied
        prepare_result: copyResults ? previousRun.prepare_result : undefined,
        // Same input state
        input_state: previousRun.input_state,
      },
      tx
    );
  });

  if (!result.newRun) {
    throw new Error("Failed to create retry run");
  }

  const newRun = result.newRun;
  log(`Created retry run ${newRun.id} with retry_of=${previousRun.id}`);
  return newRun;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Mark a handler run as failed with classified error.
 *
 * Per exec-09 spec, this sets status based on error type instead of
 * changing phase. Phase stays at the point of failure.
 */
async function failRun(
  api: KeepDbApi,
  run: HandlerRun,
  error: ClassifiedError,
  context?: HandlerExecutionContext
): Promise<void> {
  const errorType = errorTypeToHandlerErrorType(error.type);
  const status = errorTypeToRunStatus(error.type);
  await api.handlerRunStore.update(run.id, {
    // Keep phase at point of failure, set status instead
    status,
    error: error.message,
    error_type: errorType,
    end_timestamp: new Date().toISOString(),
  });
  // Extract serviceId/accountId from AuthError into context for notification creation
  if (context && error instanceof AuthError) {
    context.errorServiceId = error.serviceId;
    context.errorAccountId = error.accountId;
  }
  log(`Handler run ${run.id} ${status}: ${error.message} (${errorType})`);
}

/**
 * Mark a handler run as paused with a specific status and reason.
 *
 * Per exec-09 spec, this sets status without changing phase.
 */
async function pauseRun(
  api: KeepDbApi,
  run: HandlerRun,
  status: RunStatus,
  reason: string
): Promise<void> {
  await api.handlerRunStore.update(run.id, {
    status,
    error: reason,
    end_timestamp: new Date().toISOString(),
  });
  log(`Handler run ${run.id} ${status}: ${reason}`);
}

/**
 * Mark a handler run as suspended with reason.
 *
 * @deprecated Use pauseRun with appropriate status instead.
 * Kept for backwards compatibility during migration.
 */
async function suspendRun(
  api: KeepDbApi,
  run: HandlerRun,
  reason: string
): Promise<void> {
  await pauseRun(api, run, "paused:reconciliation", reason);
}

/**
 * Pause a handler run and its workflow for indeterminate mutation.
 *
 * Per exec-14 spec:
 * - Set run status to paused:reconciliation
 * - Pause workflow so scheduler doesn't pick it up
 * - User must manually resolve the indeterminate mutation
 */
async function pauseRunForIndeterminate(
  api: KeepDbApi,
  run: HandlerRun,
  reason: string
): Promise<void> {
  // Atomic: pause handler run + set pending_retry_run_id + pause workflow
  // pending_retry_run_id must be set atomically when marking indeterminate
  // so the scheduler can find the orphaned run when the user resolves.
  await api.db.db.tx(async (tx: DBInterface) => {
    await api.handlerRunStore.update(run.id, {
      status: "paused:reconciliation" as RunStatus,
      error: reason,
      end_timestamp: new Date().toISOString(),
    }, tx);
    await api.scriptStore.updateWorkflowFields(run.workflow_id, {
      status: "paused",
      pending_retry_run_id: run.id,
    }, tx);
  });
  log(`Handler run ${run.id} paused:reconciliation: ${reason}`);
  log(`Workflow ${run.workflow_id} paused due to indeterminate mutation, pending_retry_run_id set`);
}

// ============================================================================
// Immediate Reconciliation (exec-18)
// ============================================================================

/**
 * Handle uncertain mutation outcome with immediate reconciliation.
 *
 * Per docs/dev/13-reconciliation.md §13.7.2:
 * 1. If no reconcile method available → indeterminate immediately
 * 2. Try immediate reconciliation
 * 3. If reconcile returns applied → mark applied, proceed
 * 4. If reconcile returns failed → mark failed (can retry mutate)
 * 5. If reconcile returns retry → mark needs_reconcile (background job handles)
 *
 * @returns true if mutation resolved (applied/failed), false if needs background reconciliation
 */
async function handleUncertainOutcome(
  api: KeepDbApi,
  mutation: Mutation,
  errorMessage: string
): Promise<"applied" | "failed" | "needs_reconcile" | "indeterminate"> {
  log(`Handling uncertain outcome for mutation ${mutation.id}`);

  // Build mutation params for reconciliation
  const mutationParams: MutationParams = {
    toolNamespace: mutation.tool_namespace,
    toolMethod: mutation.tool_method,
    params: mutation.params,
    idempotencyKey: mutation.idempotency_key || undefined,
  };

  // Check if reconcile method exists
  if (!ReconciliationRegistry.hasReconcileMethod(
    mutationParams.toolNamespace,
    mutationParams.toolMethod
  )) {
    // No reconcile method - immediately indeterminate
    log(`No reconcile method for ${mutationParams.toolNamespace}:${mutationParams.toolMethod}`);
    await api.mutationStore.markIndeterminate(mutation.id, errorMessage);
    return "indeterminate";
  }

  // Attempt immediate reconciliation
  log(`Attempting immediate reconciliation for ${mutationParams.toolNamespace}:${mutationParams.toolMethod}`);
  try {
    const result = await ReconciliationRegistry.reconcile(mutationParams);

    if (!result) {
      // Registry returned null (shouldn't happen since we checked hasReconcileMethod)
      await api.mutationStore.markIndeterminate(mutation.id, errorMessage);
      return "indeterminate";
    }

    switch (result.status) {
      case "applied":
        // Mutation confirmed as committed
        log(`Immediate reconciliation confirmed applied for mutation ${mutation.id}`);
        await api.mutationStore.markApplied(
          mutation.id,
          result.result ? JSON.stringify(result.result) : ""
        );
        return "applied";

      case "failed":
        // Mutation confirmed as not committed - safe to retry
        log(`Immediate reconciliation confirmed failed for mutation ${mutation.id}`);
        await api.mutationStore.markFailed(mutation.id, errorMessage);
        return "failed";

      case "retry":
        // Reconciliation inconclusive - hand off to background
        log(`Immediate reconciliation returned retry for mutation ${mutation.id}`);
        await api.mutationStore.markNeedsReconcile(mutation.id, errorMessage);
        return "needs_reconcile";

      default:
        // Unknown status - treat as indeterminate
        await api.mutationStore.markIndeterminate(mutation.id, errorMessage);
        return "indeterminate";
    }
  } catch (error) {
    // Reconciliation attempt itself failed - treat as needs_reconcile
    log(`Immediate reconciliation threw error: ${error}`);
    await api.mutationStore.markNeedsReconcile(mutation.id, errorMessage);
    return "needs_reconcile";
  }
}

// ============================================================================
// wakeAt Constants (exec-11)
// ============================================================================

/** Minimum wakeAt interval: 30 seconds */
const MIN_WAKE_INTERVAL_MS = 30 * 1000;

/** Maximum wakeAt interval: 24 hours */
const MAX_WAKE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Clamp wakeAt to valid range (exec-11).
 *
 * Host enforces:
 * - Minimum: 30 seconds from now
 * - Maximum: 24 hours from now
 *
 * @param wakeAt - Requested wake time in milliseconds
 * @param now - Current time in milliseconds
 * @returns Clamped wake time, or 0 if invalid
 */
function clampWakeAt(wakeAt: number, now: number): number {
  if (!wakeAt || isNaN(wakeAt)) {
    return 0;
  }

  const min = now + MIN_WAKE_INTERVAL_MS;
  const max = now + MAX_WAKE_INTERVAL_MS;

  return Math.max(min, Math.min(wakeAt, max));
}

/**
 * Save prepare result, reserve events, and record wakeAt atomically.
 */
async function savePrepareAndReserve(
  api: KeepDbApi,
  run: HandlerRun,
  prepareResult: PrepareResult,
  context?: HandlerExecutionContext
): Promise<void> {
  const now = Date.now();

  // Process wakeAt (exec-11)
  let wakeAtMs = 0;
  if (prepareResult.wakeAt) {
    try {
      const parsed = new Date(prepareResult.wakeAt).getTime();
      wakeAtMs = clampWakeAt(parsed, now);
      if (wakeAtMs !== parsed) {
        log(`Handler run ${run.id} wakeAt clamped: ${prepareResult.wakeAt} → ${new Date(wakeAtMs).toISOString()}`);
      }
    } catch {
      log(`Handler run ${run.id} invalid wakeAt ignored: ${prepareResult.wakeAt}`);
    }
  }

  await api.db.db.tx(async (tx: DBInterface) => {
    // Save prepare result
    await api.handlerRunStore.update(
      run.id,
      {
        prepare_result: JSON.stringify(prepareResult),
        phase: "prepared",
      },
      tx
    );

    // Reserve events
    if (prepareResult.reservations && prepareResult.reservations.length > 0) {
      await api.eventStore.reserveEvents(run.id, prepareResult.reservations, tx);
    }

    // Record wakeAt per-consumer (exec-11)
    // Always update - 0 clears any previous wakeAt
    await api.handlerStateStore.updateWakeAt(
      run.workflow_id,
      run.handler_name,
      wakeAtMs,
      tx
    );
  });

  // Update in-memory wakeAt cache
  context?.schedulerState?.setWakeAt(run.workflow_id, run.handler_name, wakeAtMs);

  const wakeAtInfo = wakeAtMs > 0 ? `, wakeAt=${new Date(wakeAtMs).toISOString()}` : "";
  log(`Handler run ${run.id} prepared with ${prepareResult.reservations?.length || 0} reservations${wakeAtInfo}`);
}

/**
 * Commit a producer run atomically.
 * Updates handler state, marks run committed, increments handler count,
 * and updates per-producer schedule (exec-13).
 */
async function commitProducer(
  api: KeepDbApi,
  run: HandlerRun,
  newState: unknown
): Promise<void> {
  await api.db.db.tx(async (tx: DBInterface) => {
    // Update handler state
    if (newState !== undefined) {
      await api.handlerStateStore.set(
        run.workflow_id,
        run.handler_name,
        newState,
        run.id,
        tx
      );
    }

    // Mark run committed
    await api.handlerRunStore.update(
      run.id,
      {
        phase: "committed",
        status: "committed",
        output_state: JSON.stringify(newState),
        end_timestamp: new Date().toISOString(),
      },
      tx
    );

    // Update session handler count
    await api.scriptStore.incrementHandlerCount(run.script_run_id, tx);

    // Update per-producer schedule (exec-13)
    // Get the producer's schedule config and compute next run time
    const schedule = await api.producerScheduleStore.get(
      run.workflow_id,
      run.handler_name,
      tx
    );
    if (schedule) {
      const nextRunAt = computeNextRunTime(
        schedule.schedule_type,
        schedule.schedule_value
      );
      await api.producerScheduleStore.updateAfterRun(
        run.workflow_id,
        run.handler_name,
        nextRunAt,
        tx
      );
      log(`Producer ${run.handler_name} next_run_at updated to ${new Date(nextRunAt).toISOString()}`);
    }
  });
  log(`Handler run ${run.id} (producer) committed`);
}

/**
 * Commit a consumer run atomically.
 * Consumes reserved events, updates handler state, marks run committed, increments handler count.
 */
async function commitConsumer(
  api: KeepDbApi,
  run: HandlerRun,
  newState: unknown
): Promise<void> {
  await api.db.db.tx(async (tx: DBInterface) => {
    // Consume reserved events
    await api.eventStore.consumeEvents(run.id, tx);

    // Update handler state
    if (newState !== undefined) {
      await api.handlerStateStore.set(
        run.workflow_id,
        run.handler_name,
        newState,
        run.id,
        tx
      );
    }

    // Mark run committed
    await api.handlerRunStore.update(
      run.id,
      {
        phase: "committed",
        status: "committed",
        output_state: JSON.stringify(newState),
        end_timestamp: new Date().toISOString(),
      },
      tx
    );

    // Update session handler count
    await api.scriptStore.incrementHandlerCount(run.script_run_id, tx);
  });
  log(`Handler run ${run.id} (consumer) committed`);
}

// ============================================================================
// Sandbox Execution
// ============================================================================

/**
 * Create sandbox environment for handler execution.
 */
async function createHandlerSandbox(
  workflow: Workflow,
  context: HandlerExecutionContext,
  run: HandlerRun
): Promise<{ sandbox: Sandbox; toolWrapper: ToolWrapper; logs: string[] }> {
  const logs: string[] = [];

  // Create sandbox with workflow timeout
  const sandbox = await initSandbox({ timeoutMs: 300_000 });

  // Create evaluation context
  const evalContext: EvalContext = {
    taskThreadId: "",
    step: 0,
    type: "workflow",
    taskId: workflow.task_id,
    scriptRunId: run.script_run_id,
    cost: 0,
    createEvent: async () => {
      // Event creation handled via Topics.publish
    },
    onLog: async (line: string) => {
      logs.push(line);
    },
  };
  sandbox.context = evalContext;

  // Parse workflow config for topic validation (exec-15)
  let workflowConfig: WorkflowConfig | undefined;
  if (workflow.handler_config) {
    try {
      workflowConfig = JSON.parse(workflow.handler_config) as WorkflowConfig;
    } catch {
      // Invalid config - will skip topic validation
    }
  }

  // Use a ref object so tools can access the toolWrapper's phase after it's created
  const toolWrapperRef: { current: ToolWrapper | null } = { current: null };

  // Create workflow tools with phase, handler name, and config getters for topic validation
  const tools = createWorkflowTools({
    api: context.api,
    getContext: () => sandbox.context!,
    connectionManager: context.connectionManager,
    userPath: context.userPath || "",
    workflowId: workflow.id,
    scriptRunId: run.script_run_id,
    handlerRunId: run.id,
    getPhase: () => {
      const phase = toolWrapperRef.current?.getPhase();
      // Only return producer/next for topic validation; other phases don't publish
      if (phase === 'producer' || phase === 'next') return phase;
      return null;
    },
    getHandlerName: () => run.handler_name,
    getWorkflowConfig: () => workflowConfig,
    schedulerState: context.schedulerState,
  });

  // Create tool wrapper with the tools
  const toolWrapper = new ToolWrapper({
    tools,
    api: context.api,
    getContext: () => sandbox.context!,
    userPath: context.userPath,
    connectionManager: context.connectionManager,
    workflowId: workflow.id,
    scriptRunId: run.script_run_id,
    handlerRunId: run.id,
    abortController: context.abortController,
  });

  // Set the ref so getPhase callback can access the wrapper
  toolWrapperRef.current = toolWrapper;

  // Inject tools into sandbox
  const global = await toolWrapper.createGlobal();
  sandbox.setGlobal(global);

  return { sandbox, toolWrapper, logs };
}

// ============================================================================
// Producer Phase Handlers
// ============================================================================

type PhaseHandler = (
  api: KeepDbApi,
  run: HandlerRun,
  context: HandlerExecutionContext
) => Promise<void>;

const producerPhaseHandlers: Record<string, PhaseHandler> = {
  /**
   * pending → executing: Transition to executing phase.
   */
  pending: async (api: KeepDbApi, run: HandlerRun) => {
    await api.handlerRunStore.updatePhase(run.id, "executing");
    log(`Handler run ${run.id} (producer): pending → executing`);
  },

  /**
   * executing: Execute producer handler code.
   */
  executing: async (
    api: KeepDbApi,
    run: HandlerRun,
    context: HandlerExecutionContext
  ) => {
    const workflow = await api.scriptStore.getWorkflow(run.workflow_id);
    if (!workflow) {
      throw new LogicError(`Workflow ${run.workflow_id} not found`);
    }

    const script = workflow.active_script_id
      ? await api.scriptStore.getScript(workflow.active_script_id)
      : null;
    if (!script) {
      throw new LogicError(`No active script for workflow ${run.workflow_id}`);
    }

    // Pre-flight check: verify handler exists in active script's config
    if (workflow.handler_config) {
      try {
        const config = JSON.parse(workflow.handler_config) as WorkflowConfig;
        if (config.producers && !config.producers[run.handler_name]) {
          throw new InternalError(
            `Handler '${run.handler_name}' not found in active script — configuration mismatch`
          );
        }
      } catch (e) {
        if (e instanceof InternalError) throw e;
        // Invalid JSON config — skip check, let execution proceed
      }
    }

    const prevState = await api.handlerStateStore.get(
      workflow.id,
      run.handler_name
    );

    const { sandbox, toolWrapper, logs } = await createHandlerSandbox(
      workflow,
      context,
      run
    );

    try {
      // Set producer phase
      toolWrapper.setPhase("producer");

      // Inject state
      sandbox.setGlobal({ __state__: prevState });

      // Execute producer handler
      const code = `${script.code}

return await workflow.producers.${run.handler_name}.handler(__state__);
`;
      const result = await sandbox.eval(code, {
        timeoutMs: 300_000,
        signal: context.abortController?.signal,
        filename: `producer:${run.handler_name}`,
      });

      if (!result.ok) {
        // Check for classified error from context
        const classifiedError =
          sandbox.context?.classifiedError ||
          new LogicError(result.error, { source: "producer.handler" });
        await failRun(api, run, classifiedError, context);
        return;
      }

      // Commit with new state
      await commitProducer(api, run, result.result);

      // Save logs if any
      if (logs.length > 0) {
        await api.handlerRunStore.update(run.id, { logs: JSON.stringify(logs) });
      }
    } catch (error) {
      // Use getRunStatusForError instead of ensureClassified (per exec-12)
      const { error: classifiedError } = getRunStatusForError(error, "producer.handler");
      await failRun(api, run, classifiedError, context);
    } finally {
      sandbox.dispose();
    }
  },
};

// ============================================================================
// Consumer Phase Handlers
// ============================================================================

const consumerPhaseHandlers: Record<string, PhaseHandler> = {
  /**
   * pending → preparing: Transition to preparing phase.
   */
  pending: async (api: KeepDbApi, run: HandlerRun) => {
    await api.handlerRunStore.updatePhase(run.id, "preparing");
    log(`Handler run ${run.id} (consumer): pending → preparing`);
  },

  /**
   * preparing: Execute consumer prepare phase.
   */
  preparing: async (
    api: KeepDbApi,
    run: HandlerRun,
    context: HandlerExecutionContext
  ) => {
    const workflow = await api.scriptStore.getWorkflow(run.workflow_id);
    if (!workflow) {
      throw new LogicError(`Workflow ${run.workflow_id} not found`);
    }

    const script = workflow.active_script_id
      ? await api.scriptStore.getScript(workflow.active_script_id)
      : null;
    if (!script) {
      throw new LogicError(`No active script for workflow ${run.workflow_id}`);
    }

    // Pre-flight check: verify handler exists in active script's config
    if (workflow.handler_config) {
      try {
        const config = JSON.parse(workflow.handler_config) as WorkflowConfig;
        if (config.consumers && !config.consumers[run.handler_name]) {
          throw new InternalError(
            `Handler '${run.handler_name}' not found in active script — configuration mismatch`
          );
        }
      } catch (e) {
        if (e instanceof InternalError) throw e;
        // Invalid JSON config — skip check, let execution proceed
      }
    }

    const prevState = await api.handlerStateStore.get(
      workflow.id,
      run.handler_name
    );

    const { sandbox, toolWrapper, logs } = await createHandlerSandbox(
      workflow,
      context,
      run
    );

    try {
      // Set prepare phase
      toolWrapper.setPhase("prepare");

      // Inject state
      sandbox.setGlobal({ __state__: prevState });

      // Execute prepare handler
      const code = `${script.code}

return await workflow.consumers.${run.handler_name}.prepare(__state__);
`;
      const result = await sandbox.eval(code, {
        timeoutMs: 300_000,
        signal: context.abortController?.signal,
        filename: `consumer:${run.handler_name}:prepare`,
      });

      if (!result.ok) {
        const classifiedError =
          sandbox.context?.classifiedError ||
          new LogicError(result.error, { source: "consumer.prepare" });
        await failRun(api, run, classifiedError, context);
        return;
      }

      // Validate and save prepare result
      const prepareResult = result.result as PrepareResult;
      if (!prepareResult || !Array.isArray(prepareResult.reservations)) {
        await failRun(
          api,
          run,
          new LogicError(
            "Consumer prepare must return { reservations: [...] }",
            { source: "consumer.prepare" }
          )
        );
        return;
      }

      await savePrepareAndReserve(api, run, prepareResult, context);

      // Save logs if any
      if (logs.length > 0) {
        await api.handlerRunStore.update(run.id, { logs: JSON.stringify(logs) });
      }
    } catch (error) {
      // Use getRunStatusForError instead of ensureClassified (per exec-12)
      const { error: classifiedError } = getRunStatusForError(error, "consumer.prepare");
      await failRun(api, run, classifiedError, context);
    } finally {
      sandbox.dispose();
    }
  },

  /**
   * prepared: Decide next phase based on reservations.
   */
  prepared: async (api: KeepDbApi, run: HandlerRun, context: HandlerExecutionContext) => {
    const prepareResult: PrepareResult = run.prepare_result
      ? JSON.parse(run.prepare_result)
      : { reservations: [] };

    if (prepareResult.reservations.length === 0) {
      // Nothing to process, skip to committed
      log(`Handler run ${run.id} (consumer): prepared → committed (no reservations)`);
      await commitConsumer(api, run, undefined);
      context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, false);
    } else {
      // Has work to do, go to mutating
      log(`Handler run ${run.id} (consumer): prepared → mutating`);
      await api.handlerRunStore.updatePhase(run.id, "mutating");
    }
  },

  /**
   * mutating: Execute mutation or handle mutation status.
   */
  mutating: async (
    api: KeepDbApi,
    run: HandlerRun,
    context: HandlerExecutionContext
  ) => {
    const mutation = await api.mutationStore.getByHandlerRunId(run.id);

    if (!mutation) {
      // No mutation record yet — either first attempt or mutate previously
      // completed without calling a mutation tool. Execute mutate handler.
      await executeMutate(api, run, context);
    } else if (mutation.status === "in_flight") {
      // Crashed mid-mutation → uncertain outcome
      // Per exec-18: Attempt immediate reconciliation before marking indeterminate
      const outcome = await handleUncertainOutcome(
        api,
        mutation,
        "Mutation was in_flight at restart - outcome uncertain"
      );
      if (outcome === "applied") {
        // Reconciliation confirmed mutation succeeded
        log(`Handler run ${run.id} (consumer): mutating → mutated (reconciliation confirmed)`);
        await api.handlerRunStore.updatePhase(run.id, "mutated");
      } else if (outcome === "failed") {
        // Reconciliation confirmed mutation did not happen
        // State machine will restart mutate phase on next iteration
        log(`Handler run ${run.id} (consumer): reconciliation confirmed mutation failed, will retry`);
      } else if (outcome === "needs_reconcile") {
        // Reconciliation pending - pause for background reconciliation
        log(`Handler run ${run.id} (consumer): needs background reconciliation`);
        await pauseRun(api, run, "paused:reconciliation", "needs_reconcile");
      } else {
        // Indeterminate - pause workflow for user resolution
        await pauseRunForIndeterminate(api, run, "indeterminate_mutation");
      }
    } else if (mutation.status === "applied") {
      log(`Handler run ${run.id} (consumer): mutating → mutated`);
      await api.handlerRunStore.updatePhase(run.id, "mutated");
    } else if (mutation.status === "needs_reconcile") {
      // Awaiting background reconciliation - ensure run is paused
      log(`Handler run ${run.id} (consumer): awaiting reconciliation`);
      await pauseRun(api, run, "paused:reconciliation", "needs_reconcile");
    } else if (mutation.status === "indeterminate") {
      // Already indeterminate from previous attempt - ensure workflow paused
      await pauseRunForIndeterminate(api, run, "indeterminate_mutation");
    } else if (mutation.status === "failed") {
      await failRun(
        api,
        run,
        new LogicError(mutation.error || "Mutation failed", {
          source: "consumer.mutate",
        })
      );
    }
  },

  /**
   * mutated → emitting: Transition to emitting phase.
   */
  mutated: async (api: KeepDbApi, run: HandlerRun) => {
    log(`Handler run ${run.id} (consumer): mutated → emitting`);
    await api.handlerRunStore.updatePhase(run.id, "emitting");
  },

  /**
   * emitting: Execute next handler or commit if no next handler.
   */
  emitting: async (
    api: KeepDbApi,
    run: HandlerRun,
    context: HandlerExecutionContext
  ) => {
    const workflow = await api.scriptStore.getWorkflow(run.workflow_id);
    if (!workflow) {
      throw new LogicError(`Workflow ${run.workflow_id} not found`);
    }

    // Parse handler config to check for next handler
    let config: WorkflowConfig | null = null;
    if (workflow.handler_config) {
      try {
        config = JSON.parse(workflow.handler_config) as WorkflowConfig;
      } catch {
        // Invalid config, treat as no next handler
      }
    }

    const hasNext = config?.consumers?.[run.handler_name]?.hasNext ?? false;

    if (!hasNext) {
      // No next handler, commit
      log(`Handler run ${run.id} (consumer): emitting → committed (no next handler)`);
      await commitConsumer(api, run, undefined);
      context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, true);
      return;
    }

    const script = workflow.active_script_id
      ? await api.scriptStore.getScript(workflow.active_script_id)
      : null;
    if (!script) {
      throw new LogicError(`No active script for workflow ${run.workflow_id}`);
    }

    const prepareResult: PrepareResult = run.prepare_result
      ? JSON.parse(run.prepare_result)
      : { reservations: [], data: undefined };

    // Get mutation result for next phase (exec-14)
    const mutation = await api.mutationStore.getByHandlerRunId(run.id);
    const mutationResult = getMutationResultForNextPhase(mutation);

    const { sandbox, toolWrapper, logs } = await createHandlerSandbox(
      workflow,
      context,
      run
    );

    try {
      // Set next phase
      toolWrapper.setPhase("next");

      // Inject prepared data and mutation result
      sandbox.setGlobal({
        __prepared__: prepareResult,
        __mutationResult__: mutationResult,
      });

      // Execute next handler
      const code = `${script.code}

return await workflow.consumers.${run.handler_name}.next(__prepared__, __mutationResult__);
`;
      const result = await sandbox.eval(code, {
        timeoutMs: 300_000,
        signal: context.abortController?.signal,
        filename: `consumer:${run.handler_name}:next`,
      });

      if (!result.ok) {
        const classifiedError =
          sandbox.context?.classifiedError ||
          new LogicError(result.error, { source: "consumer.next" });
        await failRun(api, run, classifiedError, context);
        return;
      }

      // Commit with new state
      await commitConsumer(api, run, result.result);
      context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, true);

      // Save logs if any
      if (logs.length > 0) {
        await api.handlerRunStore.update(run.id, { logs: JSON.stringify(logs) });
      }
    } catch (error) {
      // Use getRunStatusForError instead of ensureClassified (per exec-12)
      const { error: classifiedError } = getRunStatusForError(error, "consumer.next");
      await failRun(api, run, classifiedError, context);
    } finally {
      sandbox.dispose();
    }
  },
};

// ============================================================================
// Mutation Execution
// ============================================================================

/**
 * Execute the mutate phase of a consumer handler.
 */
async function executeMutate(
  api: KeepDbApi,
  run: HandlerRun,
  context: HandlerExecutionContext
): Promise<void> {
  const workflow = await api.scriptStore.getWorkflow(run.workflow_id);
  if (!workflow) {
    throw new LogicError(`Workflow ${run.workflow_id} not found`);
  }

  // Parse handler config to check for mutate handler
  let config: WorkflowConfig | null = null;
  if (workflow.handler_config) {
    try {
      config = JSON.parse(workflow.handler_config) as WorkflowConfig;
    } catch {
      // Invalid config, treat as no mutate handler
    }
  }

  const hasMutate = config?.consumers?.[run.handler_name]?.hasMutate ?? false;

  if (!hasMutate) {
    // No mutate handler, skip to mutated
    log(`Handler run ${run.id} (consumer): mutating → mutated (no mutate handler)`);
    await api.handlerRunStore.updatePhase(run.id, "mutated");
    return;
  }

  const script = workflow.active_script_id
    ? await api.scriptStore.getScript(workflow.active_script_id)
    : null;
  if (!script) {
    throw new LogicError(`No active script for workflow ${run.workflow_id}`);
  }

  const prepareResult: PrepareResult = run.prepare_result
    ? JSON.parse(run.prepare_result)
    : { reservations: [], data: undefined };

  const { sandbox, toolWrapper, logs } = await createHandlerSandbox(
    workflow,
    context,
    run
  );

  try {
    // Set mutate phase first, then mutate context for lazy mutation creation
    // (setPhase resets mutateContext, so it must come before setMutateContext)
    toolWrapper.setPhase("mutate");
    toolWrapper.setMutateContext({
      handlerRunId: run.id,
      workflowId: run.workflow_id,
      uiTitle: prepareResult.ui?.title,
    });

    // Inject prepared data
    sandbox.setGlobal({ __prepared__: prepareResult });

    // Execute mutate handler
    const code = `${script.code}

return await workflow.consumers.${run.handler_name}.mutate(__prepared__);
`;
    const result = await sandbox.eval(code, {
      timeoutMs: 300_000,
      signal: context.abortController?.signal,
      filename: `consumer:${run.handler_name}:mutate`,
    });

    // Check if a mutation was created during execution (lazy creation by tool-wrapper)
    const mutation = await api.mutationStore.getByHandlerRunId(run.id);

    if (!result.ok) {
      // Handle error based on mutation state
      const classifiedError =
        sandbox.context?.classifiedError ||
        new LogicError(result.error, { source: "consumer.mutate" });
      // Extract service info from AuthError for notification creation
      if (classifiedError instanceof AuthError) {
        context.errorServiceId = classifiedError.serviceId;
        context.errorAccountId = classifiedError.accountId;
      }

      if (mutation) {
        if (isDefiniteFailure(classifiedError)) {
          await api.mutationStore.markFailed(
            mutation.id,
            classifiedError.message
          );
        } else if (mutation.status === "in_flight") {
          // Uncertain outcome - attempt immediate reconciliation (exec-18)
          await handleUncertainOutcome(api, mutation, classifiedError.message);
        }
      }
      // State machine will read mutation status on next iteration
      return;
    }

    // If mutation was executed (status is in_flight), mark as applied
    // Atomic checkpoint: markApplied + updatePhase in a single transaction
    if (mutation && mutation.status === "in_flight") {
      await api.db.db.tx(async (tx: DBInterface) => {
        await api.mutationStore.markApplied(mutation.id, JSON.stringify(result.result), tx);
        await api.handlerRunStore.updatePhase(run.id, "mutated", tx);
      });
    } else if (!mutation) {
      // Mutate handler completed without calling any mutation tool — no mutation record.
      // Just transition phase; next will receive { status: 'none' }.
      await api.handlerRunStore.updatePhase(run.id, "mutated");
    }

    // Save logs if any
    if (logs.length > 0) {
      await api.handlerRunStore.update(run.id, { logs: JSON.stringify(logs) });
    }
    // State machine will read mutation status and transition
  } catch (error) {
    // Use getRunStatusForError instead of ensureClassified (per exec-12)
    const { error: classifiedError } = getRunStatusForError(error, "consumer.mutate");
    // Extract service info from AuthError for notification creation
    if (classifiedError instanceof AuthError) {
      context.errorServiceId = classifiedError.serviceId;
      context.errorAccountId = classifiedError.accountId;
    }
    const mutation = await api.mutationStore.getByHandlerRunId(run.id);

    if (mutation) {
      if (isDefiniteFailure(classifiedError)) {
        await api.mutationStore.markFailed(
          mutation.id,
          classifiedError.message
        );
      } else if (mutation.status === "in_flight") {
        // Uncertain outcome - attempt immediate reconciliation (exec-18)
        await handleUncertainOutcome(api, mutation, classifiedError.message);
      }
    }
    // State machine will read mutation status on next iteration
  } finally {
    sandbox.dispose();
  }
}

// ============================================================================
// Main Execution Loop
// ============================================================================

/**
 * Execute a handler run through its state machine.
 *
 * This function is the core loop that handles both normal execution and
 * restart recovery. It continuously reads fresh state from the database
 * and processes the current phase until reaching a terminal state.
 *
 * @param handlerRunId - The handler run ID to execute
 * @param context - Execution context with API and optional resources
 * @returns The final handler result
 */
export async function executeHandler(
  handlerRunId: string,
  context: HandlerExecutionContext
): Promise<HandlerResult> {
  const { api } = context;
  // Clear stale service info from any previous handler run
  context.errorServiceId = undefined;
  context.errorAccountId = undefined;

  while (true) {
    // Always read fresh state from DB
    const run = await api.handlerRunStore.get(handlerRunId);

    if (!run) {
      return {
        phase: "failed",
        status: "failed:internal",
        error: `Handler run ${handlerRunId} not found`,
        errorType: "logic",
      };
    }

    // Check if run is done (terminal or paused) using status
    if (isRunDone(run)) {
      return {
        phase: run.phase,
        status: run.status,
        error: run.error || undefined,
        errorType: run.error_type || undefined,
        serviceId: context.errorServiceId,
        accountId: context.errorAccountId,
      };
    }

    // Get the appropriate phase handlers based on handler type
    const phaseHandlers =
      run.handler_type === "producer"
        ? producerPhaseHandlers
        : consumerPhaseHandlers;

    const handler = phaseHandlers[run.phase];
    if (!handler) {
      // Unknown phase - this shouldn't happen
      await api.handlerRunStore.update(run.id, {
        status: "failed:internal",
        error: `Unknown phase: ${run.phase}`,
        error_type: "logic",
        end_timestamp: new Date().toISOString(),
      });
      return {
        phase: run.phase,
        status: "failed:internal",
        error: `Unknown phase: ${run.phase}`,
        errorType: "logic",
      };
    }

    // Execute the phase handler
    try {
      await handler(api, run, context);
    } catch (error) {
      // Unexpected error in phase handler itself
      // Use getRunStatusForError instead of ensureClassified (per exec-12)
      const { status, error: classifiedError } = getRunStatusForError(error, "handler-state-machine");
      await failRun(api, run, classifiedError, context);
      return {
        phase: run.phase,
        status,
        error: classifiedError.message,
        errorType: errorTypeToHandlerErrorType(classifiedError.type),
        serviceId: classifiedError instanceof AuthError ? classifiedError.serviceId : undefined,
        accountId: classifiedError instanceof AuthError ? classifiedError.accountId : undefined,
      };
    }

    // Continue loop to read next state
  }
}
