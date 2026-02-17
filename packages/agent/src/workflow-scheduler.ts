import debug from "debug";
import { KeepDbApi, Workflow } from "@app/db";
import { MAX_FIX_ATTEMPTS, escalateToUser } from "./workflow-escalation";
import { WorkflowExecutionSignal, WorkflowRetryState } from "./workflow-worker-signal";
import { LogicError } from "./errors";
import { isValidEnv } from "./env";
import type { ConnectionManager } from "@app/connectors";
import {
  executeWorkflowSessionIfIdle,
  resumeIncompleteSessions,
  retryWorkflowSession,
  canStartSession,
  type SessionResult,
  type SessionTrigger,
} from "./session-orchestration";
import type { HandlerExecutionContext } from "./handler-state-machine";
import { initializeProducerSchedules } from "./producer-schedule-init";
import { isWorkflowFormatScript, validateWorkflowScript, type WorkflowConfig } from "./workflow-validator";
import { SchedulerStateManager } from "./scheduler-state";

export interface WorkflowSchedulerConfig {
  api: KeepDbApi;
  userPath?: string; // path to user files directory
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
}

export class WorkflowScheduler {
  private api: KeepDbApi;
  private userPath?: string;
  public readonly connectionManager?: ConnectionManager;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  // Workflow state map for retry backoff (reset on program restart)
  private workflowRetryState: Map<string, WorkflowRetryState> = new Map();

  // Global pause for PAYMENT_REQUIRED errors
  private globalPauseUntil: number = 0;

  // In-memory scheduler state for dirty flags and wakeAt caching
  private schedulerState: SchedulerStateManager = new SchedulerStateManager();

  // Maximum number of consecutive network error retries before escalating to user
  // After this many retries, the workflow needs user attention
  private static readonly MAX_NETWORK_RETRIES = 5;

  private debug = debug("agent:WorkflowScheduler");

  constructor(config: WorkflowSchedulerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;

    this.debug("Constructed");
  }

  /**
   * Handle signals about execution outcomes
   */
  private async handleWorkerSignal(signal: WorkflowExecutionSignal): Promise<void> {
    this.debug("Received signal:", signal);

    switch (signal.type) {
      case 'retry': {
        // Get or create retry state
        const currentState = this.workflowRetryState.get(signal.workflowId) || {
          retryCount: 0,
          nextStart: 0,
          originalRunId: signal.scriptRunId || '', // Track the first failed run
        };

        // Increment retry count
        currentState.retryCount += 1;

        // If this is a new retry chain (first failure), set the original run ID
        // Otherwise keep the existing originalRunId (it's the first failure in the chain)
        if (!currentState.originalRunId && signal.scriptRunId) {
          currentState.originalRunId = signal.scriptRunId;
        }

        // Check if max retries exceeded - escalate to user attention
        if (currentState.retryCount > WorkflowScheduler.MAX_NETWORK_RETRIES) {
          // Log with error context like 'needs_attention' case for consistency
          this.debug(
            `Workflow ${signal.workflowId} exceeded max retries (${currentState.retryCount}/${WorkflowScheduler.MAX_NETWORK_RETRIES}), escalating to user attention (${signal.errorType || 'network'}): ${signal.error || 'Max retries exceeded'}`
          );

          // Mark workflow as error status and clear pending_retry_run_id
          await this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
            status: 'error',
            pending_retry_run_id: '',
          });
          this.workflowRetryState.delete(signal.workflowId);
          break;
        }

        // Calculate exponential backoff
        const baseDelayMs = 10 * 1000; // 10 seconds in milliseconds
        const exponentialDelayMs = baseDelayMs * Math.pow(2, currentState.retryCount - 1);
        const maxDelayMs = 10 * 60 * 1000; // 10 minutes in milliseconds
        const actualDelayMs = Math.min(exponentialDelayMs, maxDelayMs);

        // Set next start time
        currentState.nextStart = Date.now() + actualDelayMs;
        this.workflowRetryState.set(signal.workflowId, currentState);

        this.debug(
          `Workflow ${signal.workflowId} retry scheduled in ${actualDelayMs}ms (attempt ${currentState.retryCount}/${WorkflowScheduler.MAX_NETWORK_RETRIES}, originalRunId: ${currentState.originalRunId})`
        );
        break;
      }

      case 'payment_required':
        this.globalPauseUntil = Date.now() + 10 * 60 * 1000;
        this.debug(
          `Global pause active until ${new Date(this.globalPauseUntil).toISOString()}`
        );
        break;

      case 'done':
        this.workflowRetryState.delete(signal.workflowId);
        // Reset maintenance fix count on successful completion
        await this.api.scriptStore.resetMaintenanceFixCount(signal.workflowId);
        this.debug(`Workflow ${signal.workflowId} completed successfully, retry state cleared`);
        break;

      case 'needs_attention':
        // User action required (auth/permission errors)
        // Clear retry state since retries won't help
        this.workflowRetryState.delete(signal.workflowId);
        this.debug(
          `Workflow ${signal.workflowId} needs user attention (${signal.errorType}): ${signal.error}`
        );
        break;

      case 'maintenance':
        // Workflow entered maintenance mode for agent auto-fix
        // Clear retry state - the workflow will be skipped until maintenance is cleared
        this.workflowRetryState.delete(signal.workflowId);
        this.debug(
          `Workflow ${signal.workflowId} entered maintenance mode for auto-fix (${signal.errorType}): ${signal.error}`
        );
        break;
    }
  }

  async close(): Promise<void> {
    // Set shutdown flag to prevent new work from starting
    this.isShuttingDown = true;

    // Clear interval to stop scheduling new checkWork calls
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    // Wait for in-progress work to complete with timeout
    const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds
    const POLL_INTERVAL_MS = 100;
    const startTime = Date.now();

    while (this.isRunning) {
      if (Date.now() - startTime > SHUTDOWN_TIMEOUT_MS) {
        this.debug("Warning: Shutdown timeout reached with work still in progress");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    this.debug("Scheduler closed");
  }

  public async start(): Promise<void> {
    if (this.interval) return;

    // Resume any incomplete sessions from app restart (exec-07)
    try {
      await this.resumeIncompleteSessions();
    } catch (e) {
      this.debug("Error resuming incomplete sessions:", e);
    }

    // Initialize scheduler state for all active workflows (sets consumers dirty for restart recovery)
    try {
      await this.initializeSchedulerState();
    } catch (e) {
      this.debug("Error initializing scheduler state:", e);
    }

    // Backfill handler_config for pre-migration scripts (one-time on startup)
    try {
      await this.backfillScriptHandlerConfigs();
    } catch (e) {
      this.debug("Error backfilling script handler configs:", e);
    }

    // Ensure producer schedules exist for all active workflows
    try {
      await this.ensureProducerSchedules();
    } catch (e) {
      this.debug("Error ensuring producer schedules:", e);
    }

    // Release orphaned event reservations from previous run
    try {
      const released = await this.api.eventStore.releaseOrphanedReservedEvents();
      if (released > 0) {
        this.debug(`Released ${released} orphaned reserved events`);
      }
    } catch (e) {
      this.debug("Error releasing reserved events:", e);
    }

    this.interval = setInterval(() => this.checkWork(), 10000);

    // check immediately
    this.checkWork();
  }

  /**
   * Resume incomplete workflow sessions on startup.
   * Called automatically by start().
   */
  private async resumeIncompleteSessions(): Promise<void> {
    const context = this.createExecutionContext();
    this.debug("Resuming incomplete sessions...");
    await resumeIncompleteSessions(context);
    this.debug("Incomplete sessions resumed");
  }

  /**
   * Ensure all active workflows have producer schedule rows.
   * Handles workflows created before producer-schedule initialization was wired up.
   */
  private async ensureProducerSchedules(): Promise<void> {
    const allWorkflows = await this.api.scriptStore.listWorkflows(1000, 0);
    const activeWithConfig = allWorkflows.filter(
      (w) => w.status === "active" && w.handler_config && w.handler_config.trim() !== ''
    );

    for (const workflow of activeWithConfig) {
      const existing = await this.api.producerScheduleStore.getForWorkflow(workflow.id);
      if (existing.length > 0) continue;

      // No schedule rows — parse handler_config and initialize
      try {
        const config: WorkflowConfig = JSON.parse(workflow.handler_config!);
        await initializeProducerSchedules(workflow.id, config, this.api.producerScheduleStore);
        this.debug(`Initialized missing producer schedules for workflow ${workflow.id} (${workflow.title})`);
      } catch (e) {
        this.debug(`Failed to initialize producer schedules for workflow ${workflow.id}:`, e);
      }
    }
  }

  /**
   * Backfill handler_config for pre-migration scripts that have empty handler_config.
   * Parses script code to extract config and saves it back to the script record.
   * Also updates the workflow's handler_config if it's empty.
   */
  private async backfillScriptHandlerConfigs(): Promise<void> {
    const allWorkflows = await this.api.scriptStore.listWorkflows(1000, 0);
    const active = allWorkflows.filter(
      (w) => w.status === "active" && w.active_script_id
    );

    for (const workflow of active) {
      try {
        const script = await this.api.scriptStore.getScript(workflow.active_script_id);
        if (!script || script.handler_config) continue;

        // Script has empty handler_config — try to parse from code
        if (!isWorkflowFormatScript(script.code)) continue;

        const validation = await validateWorkflowScript(script.code);
        if (!validation.valid || !validation.config) continue;

        const configJson = JSON.stringify(validation.config);

        // Save to script record
        await this.api.scriptStore.updateScriptHandlerConfig(script.id, configJson);
        this.debug(`Backfilled handler_config for script ${script.id} (workflow ${workflow.title})`);

        // Also fix workflow's handler_config if empty
        if (!workflow.handler_config) {
          await this.api.scriptStore.updateWorkflowFields(workflow.id, {
            handler_config: configJson,
          });
          this.debug(`Backfilled handler_config for workflow ${workflow.id} (${workflow.title})`);
        }
      } catch (e) {
        this.debug(`Failed to backfill handler_config for workflow ${workflow.id}:`, e);
      }
    }
  }

  /**
   * Initialize scheduler state for all active workflows on startup.
   * Sets all consumers dirty (conservative — may cause one extra prepare per consumer).
   * Loads persisted wakeAt values from DB.
   */
  private async initializeSchedulerState(): Promise<void> {
    const allWorkflows = await this.api.scriptStore.listWorkflows(1000, 0);
    const activeWithConfig = allWorkflows.filter(
      (w) => w.status === "active" && w.handler_config && w.handler_config.trim() !== ''
    );

    for (const workflow of activeWithConfig) {
      try {
        const config: WorkflowConfig = JSON.parse(workflow.handler_config!);
        // Set all consumers dirty on startup (restart recovery)
        this.schedulerState.initializeForWorkflow(workflow.id, config, workflow.active_script_id);

        // Load persisted wakeAt values from DB
        const handlerStates = await this.api.handlerStateStore.listByWorkflow(workflow.id);
        for (const hs of handlerStates) {
          if (hs.wake_at > 0 && config.consumers?.[hs.handler_name]) {
            this.schedulerState.setWakeAt(workflow.id, hs.handler_name, hs.wake_at);
          }
        }
      } catch (e) {
        this.debug(`Failed to initialize scheduler state for workflow ${workflow.id}:`, e);
      }
    }

    this.debug(`Initialized scheduler state for ${activeWithConfig.length} active workflows`);
  }

  /**
   * Create the execution context needed for session-based workflow execution.
   */
  private createExecutionContext(): HandlerExecutionContext {
    return {
      api: this.api,
      connectionManager: this.connectionManager,
      userPath: this.userPath,
      schedulerState: this.schedulerState,
    };
  }

  public async checkWork(): Promise<void> {
    if (!isValidEnv()) {
      this.debug("No api keys or invalid env config");
      return;
    }

    // Check if authentication is required (needAuth flag set in database)
    try {
      const needAuthState = await this.api.getNeedAuth();
      if (needAuthState.needed) {
        this.debug("Authentication required, pausing workflow processing (reason: %s)", needAuthState.reason);
        return;
      }
    } catch (e) {
      this.debug("Error checking needAuth state:", e);
      // Continue processing if we can't check the flag
    }

    this.debug(
      "checkWork, running",
      this.isRunning,
      "shuttingDown",
      this.isShuttingDown
    );
    if (this.isShuttingDown) return;
    if (this.isRunning) return;
    this.isRunning = true;
    let processed = false;

    try {
      // Get workflows and check if any should run
      processed = await this.processNextWorkflow();
    } catch (e) {
      this.debug("Error processing workflow:", e);
    }

    // Done
    this.isRunning = false;

    // Retry immediately in case more workflows might need execution
    if (processed) this.checkWork();
  }

  private async processNextWorkflow(): Promise<boolean> {
    try {
      this.debug(`checking @ ${new Date().toISOString()}`);

      // Check global pause for PAYMENT_REQUIRED errors
      if (this.globalPauseUntil > Date.now()) {
        this.debug(
          `Global pause active until ${new Date(
            this.globalPauseUntil
          ).toISOString()}`
        );
        return false;
      }

      // Get all workflows
      const allWorkflows = await this.api.scriptStore.listWorkflows(1000, 0);

      // Filter active workflows - per spec 06, only workflows with status="active" run
      // Draft ("draft"), Ready ("ready"), Paused ("paused"), and Error ("error") workflows do not run on schedule
      const activeWorkflows: Workflow[] = [];
      for (const w of allWorkflows) {
        if (w.status !== 'active' || w.maintenance) continue;

        // Guard: workflows without handler_config cannot run — pause to prevent infinite loops
        if (!w.handler_config || !w.handler_config.trim()) {
          this.debug(`Pausing workflow ${w.id} (${w.title}): missing handler_config`);
          await this.api.scriptStore.updateWorkflowFields(w.id, { status: 'error' });
          try {
            await this.api.notificationStore.saveNotification({
              id: crypto.randomUUID(),
              workflow_id: w.id,
              type: 'escalated',
              payload: JSON.stringify({
                error_type: 'missing_config',
                error_message: 'Workflow has no handler configuration. Re-activate the script to fix.',
              }),
              timestamp: new Date().toISOString(),
              acknowledged_at: '',
              resolved_at: '',
              workflow_title: w.title,
            });
          } catch { /* notification is best-effort */ }
          continue;
        }

        // Guard: workflows with indeterminate mutations must not run — re-pause
        const indeterminate = await this.api.mutationStore.getByWorkflow(w.id, { status: "indeterminate" });
        if (indeterminate.length > 0) {
          this.debug(`Workflow ${w.id} has indeterminate mutations, re-pausing`);
          await this.api.scriptStore.updateWorkflowFields(w.id, { status: 'paused' });
          continue;
        }

        activeWorkflows.push(w);
      }

      this.debug(`Found ${activeWorkflows.length} active workflows`);

      const currentTime = Date.now();
      const context = this.createExecutionContext();

      // Ensure scheduler state is initialized for all active workflows.
      // Handles workflows that became active since startup (e.g. unpaused).
      // Must run before priority checks so consumers have correct dirty flags
      // when sessions execute.
      for (const workflow of activeWorkflows) {
        if (!workflow.handler_config) continue;
        const needsInit = !this.schedulerState.isWorkflowTracked(workflow.id) ||
          (workflow.active_script_id && this.schedulerState.isWorkflowStale(workflow.id, workflow.active_script_id));
        if (needsInit) {
          try {
            const config = JSON.parse(workflow.handler_config) as WorkflowConfig;
            if (config.consumers && Object.keys(config.consumers).length > 0) {
              this.schedulerState.initializeForWorkflow(workflow.id, config, workflow.active_script_id);
              this.debug(`Auto-initialized scheduler state for workflow ${workflow.id} (${workflow.title})`);
            }
          } catch {
            // Invalid config, skip
          }
        }
      }

      // Priority 1: Check pending_retry_run_id — unified retry recovery
      for (const workflow of activeWorkflows) {
        if (!workflow.pending_retry_run_id) continue;

        // Skip if in retry backoff (transient errors)
        const retryState = this.workflowRetryState.get(workflow.id);
        if (retryState && retryState.nextStart > currentTime) {
          this.debug(
            `Skipping retry for workflow ${workflow.id} in backoff until ${new Date(retryState.nextStart).toISOString()}`
          );
          continue;
        }

        // Check single-threaded constraint
        const canStart = await canStartSession(this.api, workflow.id);
        if (!canStart) {
          this.debug(`Skipping retry for workflow ${workflow.id}: another session is active`);
          continue;
        }

        this.debug(
          `Executing retry for workflow ${workflow.id} (${workflow.title}), pending_retry_run_id=${workflow.pending_retry_run_id}`
        );

        try {
          const result = await retryWorkflowSession(workflow, workflow.pending_retry_run_id, context);
          await this.postSessionResult(workflow, result);
        } catch (error) {
          this.debug("failed to process retry workflow:", error);
        }

        return true;
      }

      // Priority 2: Check which workflows should run based on per-producer schedules
      const dueWorkflows: { workflow: Workflow; trigger: SessionTrigger }[] = [];

      for (const workflow of activeWorkflows) {
        try {
          const dueProducers = await this.api.producerScheduleStore.getDueProducers(workflow.id);
          if (dueProducers.length > 0) {
            dueWorkflows.push({ workflow, trigger: 'schedule' });
            this.debug(
              `Workflow ${workflow.id} (${workflow.title}) has ${dueProducers.length} due producers`
            );
          }
        } catch (error) {
          this.debug(`Error checking producer schedules for workflow ${workflow.id}:`, error);
        }
      }

      // Priority 3: Consumer-only work detection (in-memory, zero DB queries)
      // For active workflows not already in dueWorkflows and not in retry backoff
      const dueWorkflowIds = new Set(dueWorkflows.map(d => d.workflow.id));
      for (const workflow of activeWorkflows) {
        if (dueWorkflowIds.has(workflow.id)) continue;
        if (workflow.pending_retry_run_id) continue; // Already handled above (in backoff)

        const retryState = this.workflowRetryState.get(workflow.id);
        if (retryState && retryState.nextStart > currentTime) continue;

        // Check if any consumer is dirty (new events since last run) — in-memory
        const dirtyConsumers = this.schedulerState.getDirtyConsumers(workflow.id);
        if (dirtyConsumers.length > 0) {
          dueWorkflows.push({ workflow, trigger: 'event' });
          this.debug(`Workflow ${workflow.id} (${workflow.title}) has consumer-only work (${dirtyConsumers.length} dirty consumers)`);
          continue;
        }

        // Check for due wakeAt times — in-memory
        const dueConsumers = this.schedulerState.getConsumersWithDueWakeAt(workflow.id);
        if (dueConsumers.length > 0) {
          dueWorkflows.push({ workflow, trigger: 'event' });
          this.debug(`Workflow ${workflow.id} (${workflow.title}) has consumer-only work (due wakeAt)`);
        }
      }

      // Filter out workflows in retry backoff
      const availableWorkflows = dueWorkflows.filter(({ workflow }) => {
        const retryState = this.workflowRetryState.get(workflow.id);
        if (retryState && retryState.nextStart > currentTime) {
          this.debug(
            `Skipping workflow ${workflow.id} in backoff until ${new Date(
              retryState.nextStart
            ).toISOString()}`
          );
          return false;
        }
        return true;
      });

      this.debug(`${availableWorkflows.length} workflows ready to execute`);

      // Execute first available workflow
      if (availableWorkflows.length > 0) {
        const { workflow, trigger } = availableWorkflows[0];
        const retryState = this.workflowRetryState.get(workflow.id);

        this.debug(
          `Triggering workflow: ${workflow.title} (${workflow.id})`,
          retryState ? `(retry #${retryState.retryCount} of ${retryState.originalRunId})` : `(fresh run, trigger=${trigger})`
        );

        try {
          await this.executeNewFormatWorkflow(workflow, trigger);
        } catch (error) {
          this.debug("failed to process workflow:", error);
        }

        return true;
      }

      return false;
    } catch (err) {
      this.debug("processNextWorkflow error:", err);
      return false;
    }
  }

  /**
   * Execute a workflow using session orchestration (exec-07).
   * This uses the executeWorkflowSessionIfIdle function which enforces
   * single-threaded execution (only one session per workflow at a time).
   */
  private async executeNewFormatWorkflow(workflow: Workflow, trigger: SessionTrigger = 'schedule'): Promise<void> {
    this.debug(`Executing workflow ${workflow.id} via session orchestration (trigger: ${trigger})`);

    const context = this.createExecutionContext();
    const result = await executeWorkflowSessionIfIdle(
      workflow,
      trigger,
      context
    );

    if (result === null) {
      // Another session is already active, skip this trigger
      this.debug(`Skipped workflow ${workflow.id}: another session is active`);
      return;
    }

    await this.postSessionResult(workflow, result);
  }

  /**
   * Common post-session handling: route maintenance results and emit signals.
   * Used by both executeNewFormatWorkflow and pending_retry_run_id handling.
   */
  private async postSessionResult(workflow: Workflow, result: SessionResult): Promise<void> {
    // Route maintenance results to enterMaintenanceMode before signaling
    if (result.status === 'maintenance') {
      await this.enterMaintenanceModeForSession(workflow, result);
    }

    // Handle session result by emitting appropriate signals
    await this.handleSessionResult(workflow.id, result);
  }

  /**
   * Enter maintenance mode for a session that failed with a logic error.
   * Re-fetches the workflow to get current fix count, then either
   * creates a maintainer task or escalates to the user.
   */
  private async enterMaintenanceModeForSession(
    workflow: Workflow,
    result: SessionResult
  ): Promise<void> {
    // Re-fetch to get current maintenance_fix_count
    const freshWorkflow = await this.api.scriptStore.getWorkflow(workflow.id);
    if (!freshWorkflow) {
      this.debug(`enterMaintenanceModeForSession: workflow ${workflow.id} not found`);
      return;
    }

    const fixCount = freshWorkflow.maintenance_fix_count || 0;

    // Check if this failure would exhaust the fix attempt budget.
    // fixCount tracks completed maintenance entries. This new failure would be
    // entry #(fixCount+1). When that reaches MAX_FIX_ATTEMPTS, escalate instead
    // of creating another maintainer — the user should fix it interactively.
    if (fixCount + 1 >= MAX_FIX_ATTEMPTS) {
      this.debug(
        `Workflow ${workflow.id} reached max fix attempts (${fixCount + 1}/${MAX_FIX_ATTEMPTS}), escalating to user`
      );
      await escalateToUser(this.api, {
        workflow: freshWorkflow,
        scriptRunId: result.sessionId || '',
        error: new LogicError(result.error || 'Logic error'),
        logs: [], // Session-level logs are empty for new-format workflows
        fixAttempts: fixCount + 1,
      });
      return;
    }

    // Enter maintenance mode: creates maintainer task + inbox item
    await this.api.enterMaintenanceMode({
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      scriptRunId: result.sessionId || '',
      handlerRunId: result.handlerRunId,
      handlerName: result.handlerName,
    });

    this.debug(
      `Entered maintenance mode for workflow ${workflow.id}, ` +
      `handler: ${result.handlerName || '(none)'}, ` +
      `fix attempt ${fixCount + 1}/${MAX_FIX_ATTEMPTS - 1}`
    );
  }

  /**
   * Handle the result of a session execution and emit appropriate signals.
   */
  private async handleSessionResult(workflowId: string, result: SessionResult): Promise<void> {
    switch (result.status) {
      case 'completed':
        this.debug(`Session ${result.sessionId} completed for workflow ${workflowId}`);
        // Signal success to scheduler (same as old-format completion)
        await this.handleWorkerSignal({
          type: 'done',
          workflowId,
          timestamp: Date.now(),
          scriptRunId: result.sessionId,
        });
        break;

      case 'suspended':
        this.debug(`Session ${result.sessionId} suspended for workflow ${workflowId}: ${result.reason}`);
        // Workflow was paused (status already set by session-orchestration)
        // Clear retry state - user needs to manually resume
        this.workflowRetryState.delete(workflowId);
        break;

      case 'failed':
        this.debug(`Session ${result.sessionId} failed for workflow ${workflowId}: ${result.error}`);
        // Session-orchestration already set workflow status to 'error'
        // Signal that user needs attention
        await this.handleWorkerSignal({
          type: 'needs_attention',
          workflowId,
          timestamp: Date.now(),
          error: result.error || 'Session failed',
          errorType: 'logic',
          scriptRunId: result.sessionId,
        });
        break;

      case 'maintenance':
        this.debug(`Session ${result.sessionId} entered maintenance for workflow ${workflowId}: ${result.error}`);
        // enterMaintenanceModeForSession already handled DB work
        // Signal maintenance mode to clear retry state
        await this.handleWorkerSignal({
          type: 'maintenance',
          workflowId,
          timestamp: Date.now(),
          error: result.error || 'Logic error - entering maintenance',
          errorType: 'logic',
          scriptRunId: result.sessionId,
        });
        break;

      case 'transient':
        this.debug(`Session ${result.sessionId} hit transient error for workflow ${workflowId}: ${result.error}`);
        // Set pending_retry_run_id for retry after backoff
        await this.api.scriptStore.updateWorkflowFields(workflowId, {
          pending_retry_run_id: result.handlerRunId || '',
        });
        // Use existing backoff mechanism
        await this.handleWorkerSignal({
          type: 'retry',
          workflowId,
          timestamp: Date.now(),
          error: result.error || 'Transient error',
          errorType: 'network',
          scriptRunId: result.sessionId,
        });
        break;
    }
  }
}
