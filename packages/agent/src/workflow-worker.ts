import { generateId } from "ai";
import { initSandbox, Sandbox } from "./sandbox/sandbox";
import debug from "debug";
import { KeepDbApi, Workflow, Script, DBInterface } from "@app/db";
import { SandboxAPI } from "./sandbox/api";
import { fileUtils } from "@app/node";
import { ERROR_BAD_REQUEST, ERROR_PAYMENT_REQUIRED } from "./agent";
import { WorkflowSignalHandler } from "./workflow-worker-signal";
import {
  isClassifiedError,
  ClassifiedError,
  AuthError,
  PermissionError,
  NetworkError,
  LogicError,
  InternalError,
  ErrorType,
  WorkflowPausedError,
  isWorkflowPausedError,
} from "./errors";
import type { ConnectionManager } from "@app/connectors";

// Maximum number of consecutive fix attempts before escalating to user (spec 09b)
// After this many failed auto-fix attempts, the workflow is paused and user is notified.
const MAX_FIX_ATTEMPTS = 3;

export interface WorkflowWorkerConfig {
  api: KeepDbApi;
  userPath?: string; // path to user files directory
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
  onSignal?: WorkflowSignalHandler; // Callback for scheduling signals
}

/**
 * WorkflowWorker executes individual workflows by running their associated scripts.
 * Use WorkflowScheduler for automatic workflow scheduling and retry management.
 */
export class WorkflowWorker {
  private api: KeepDbApi;
  private userPath?: string;
  public readonly connectionManager?: ConnectionManager;
  private onSignal?: WorkflowSignalHandler;

  private debug = debug("agent:WorkflowWorker");

  constructor(config: WorkflowWorkerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;
    this.onSignal = config.onSignal;
    this.debug("Constructed");
  }

  /**
   * Execute a single workflow by running its associated script.
   * This is the main entry point for workflow execution.
   *
   * @param workflow - The workflow to execute
   * @param retryOf - ID of the original failed script run (for retry tracking)
   * @param retryCount - Which retry attempt this is (0 for first attempt)
   * @param runType - Type of run: "workflow" for scheduled runs, "test" for test/dry runs
   */
  public async executeWorkflow(
    workflow: Workflow,
    retryOf: string = '',
    retryCount: number = 0,
    runType: string = 'workflow',
    scriptRunId?: string
  ): Promise<void> {
    this.debug("Execute workflow", workflow, "retryOf:", retryOf, "retryCount:", retryCount, "runType:", runType, "scriptRunId:", scriptRunId);

    try {
      // Use the active script pointed to by the workflow
      // This is more efficient than querying for "latest" and supports version switching
      if (!workflow.active_script_id) {
        this.debug("No active script ID for workflow", workflow.id);
        throw new Error(`No active script for workflow ${workflow.id}. Please save a script first.`);
      }

      const script = await this.api.scriptStore.getScript(workflow.active_script_id);
      if (!script) {
        this.debug("Active script not found", workflow.active_script_id, "for workflow", workflow.id);
        throw new Error(`Active script ${workflow.active_script_id} not found for workflow ${workflow.id}`);
      }

      await this.processWorkflowScript(workflow, script, retryOf, retryCount, runType, scriptRunId);
    } catch (error) {
      this.debug("Workflow handling error:", error);
      throw error;
    }
  }

  /**
   * Emit a signal to the scheduler (if callback is provided)
   */
  private emitSignal(signal: Parameters<WorkflowSignalHandler>[0]): void {
    if (this.onSignal) {
      try {
        this.onSignal(signal);
      } catch (error) {
        this.debug("Error in signal handler:", error);
      }
    }
  }

  private async processWorkflowScript(
    workflow: Workflow,
    script: Script,
    retryOf: string = '',
    retryCount: number = 0,
    runType: string = 'workflow',
    providedScriptRunId?: string
  ) {
    // Use provided ID or generate a new one (allows caller to know the run ID upfront)
    const scriptRunId = providedScriptRunId || generateId();
    this.debug(
      "Running script run",
      scriptRunId,
      "script",
      script.id,
      "workflow",
      workflow.id,
      "retryOf:",
      retryOf,
      "retryCount:",
      retryCount,
      "runType:",
      runType
    );

    // For test runs, skip maintenance mode and auto-retry logic
    const isTestRun = runType === 'test';

    await this.api.scriptStore.startScriptRun(
      scriptRunId,
      script.id,
      new Date().toISOString(),
      workflow.id,
      runType,
      retryOf,
      retryCount
    );

    // Initialize logs array for this script run
    const logs: string[] = [];

    // Declare sandbox outside try block so we can access cost in both success and error paths
    let sandbox: Sandbox | undefined;
    // AbortController for terminating script on fatal errors (invalid input)
    const abortController = new AbortController();

    try {
      // JS sandbox with proper 'context' object
      sandbox = await this.createSandbox(
        workflow,
        scriptRunId,
        logs,
        script.id
      );

      // Inits JS API in the sandbox
      await this.createEnv(workflow, sandbox, abortController);

      // Run the code
      const result = await sandbox.eval(script.code, {
        timeoutMs: 300000,
        signal: abortController.signal,
      });

      if (result.ok) {
        this.debug("Script result", result.result);
      } else {
        this.debug("Script error", result.error);
        // Check for classified error stored before abort (survives QuickJS boundary)
        const classifiedError = sandbox.context?.classifiedError;
        if (classifiedError) {
          throw classifiedError;
        }
        throw new Error(result.error);
      }

      // Convert accumulated cost from dollars to microdollars for storage
      const costMicrodollars = Math.ceil((sandbox.context?.cost || 0) * 1000000);

      // Workflow script finished ok
      await this.api.scriptStore.finishScriptRun(
        scriptRunId,
        new Date().toISOString(),
        JSON.stringify(result.result) || "",
        "",
        logs.join("\n"),
        "", // no error_type for successful runs
        costMicrodollars
      );

      // For test runs, skip scheduler signals
      if (!isTestRun) {
        // Note: workflow.timestamp is the creation time, not last run time.
        // Script runs track actual execution times via script_runs table.
        // The next_run_timestamp field is used for scheduling.

        // Reset maintenance fix count on successful run (the fix worked!)
        // This prevents old fix counts from persisting after issues are resolved
        if (workflow.maintenance_fix_count > 0) {
          await this.api.scriptStore.resetMaintenanceFixCount(workflow.id);
          this.debug("Reset maintenance fix count for workflow", workflow.id);
        }

        // Check for warnings or errors in logs and notify
        await this.checkLogsAndNotify(workflow, scriptRunId, logs);

        // Signal success to scheduler
        this.emitSignal({
          type: "done",
          workflowId: workflow.id,
          timestamp: Date.now(),
          scriptRunId,
        });
      } else {
        this.debug("Test run completed successfully, skipping workflow updates and signals");
      }
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      // Handle WorkflowPausedError specially - it's a clean abort, not a failure
      if (isWorkflowPausedError(error)) {
        this.debug("WORKFLOW_PAUSED: User paused workflow during execution", workflow.id);

        try {
          // Convert accumulated cost from dollars to microdollars for storage
          const costMicrodollars = Math.ceil((sandbox?.context?.cost || 0) * 1000000);

          // Record as a clean abort with result "paused" instead of error
          await this.api.scriptStore.finishScriptRun(
            scriptRunId,
            new Date().toISOString(),
            '"paused"', // Result indicating clean pause
            "", // No error message
            logs.join("\n"),
            "", // No error type
            costMicrodollars
          );
        } catch (e) {
          this.debug("finishScriptRun error", e);
        }

        // Don't change workflow status - user already set it to paused/error
        // Just signal done (no retry needed) and don't re-throw
        this.emitSignal({
          type: "done",
          workflowId: workflow.id,
          timestamp: Date.now(),
          scriptRunId,
        });

        // Don't re-throw - this is a clean abort, not an error
        return;
      }

      // Determine error_type for storage and notification filtering
      let errorType: ErrorType | '' = '';
      if (error === ERROR_BAD_REQUEST) {
        errorType = 'internal'; // BAD_REQUEST indicates a bug in our code
      } else if (error === ERROR_PAYMENT_REQUIRED) {
        errorType = 'auth'; // PAYMENT_REQUIRED treated as auth since it requires user action (payment/authentication)
      } else if (isClassifiedError(error)) {
        errorType = (error as ClassifiedError).type;
      }

      try {
        // Convert accumulated cost from dollars to microdollars for storage (may be partially accumulated before error)
        const costMicrodollars = Math.ceil((sandbox?.context?.cost || 0) * 1000000);

        await this.api.scriptStore.finishScriptRun(
          scriptRunId,
          new Date().toISOString(),
          "",
          errorMessage,
          logs.join("\n"),
          errorType,
          costMicrodollars
        );
      } catch (e) {
        this.debug("finishScriptRun error", e);
      }

      // Check for warnings or errors in logs and notify
      try {
        await this.checkLogsAndNotify(workflow, scriptRunId, logs);
      } catch (e) {
        this.debug("checkLogsAndNotify error", e);
      }

      // For test runs, skip workflow status changes, maintenance mode, and scheduler signals
      // Just record the error in script_runs and re-throw
      if (isTestRun) {
        this.debug("Test run error, skipping workflow status changes and signals:", errorMessage);
        throw error;
      }

      // Handle different error types based on classification
      if (error === ERROR_BAD_REQUEST) {
        this.debug("BAD_REQUEST (internal error): will not retry the workflow", workflow.id);

        // Mark workflow as error status
        // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
        try {
          await this.api.scriptStore.updateWorkflowFields(workflow.id, {
            status: "error",
          });
        } catch (e) {
          this.debug("updateWorkflow error", e);
        }

        // Signal that user needs attention - this is an internal bug, can't be auto-fixed
        this.emitSignal({
          type: "needs_attention",
          workflowId: workflow.id,
          timestamp: Date.now(),
          error: errorMessage,
          errorType: "internal",
          scriptRunId,
        });
      } else if (error === ERROR_PAYMENT_REQUIRED) {
        this.debug("PAYMENT_REQUIRED: Sending global pause signal");

        // Signal global pause to scheduler
        this.emitSignal({
          type: "payment_required",
          workflowId: workflow.id,
          timestamp: Date.now(),
          error: errorMessage,
          scriptRunId,
        });
      } else if (isClassifiedError(error)) {
        // Handle classified errors based on type
        const classifiedError = error as ClassifiedError;
        this.debug(
          `Classified error [${classifiedError.type}]:`,
          classifiedError.message,
          "source:",
          classifiedError.source
        );

        switch (classifiedError.type) {
          case "auth":
          case "permission":
            // Auth/Permission errors require user action - no auto-retry
            // User must reconnect/grant access
            this.debug(`${classifiedError.type.toUpperCase()}: User action required, not retrying workflow`, workflow.id);

            // Set needAuth flag if this is an LLM auth error (not tool-specific auth like Gmail)
            // This pauses all schedulers until user re-authenticates
            if (classifiedError.type === "auth" && classifiedError.source === "llm") {
              try {
                await this.api.setNeedAuth(true, "auth_error");
                this.debug("Set needAuth flag due to LLM auth error");
              } catch (e) {
                this.debug("Error setting needAuth flag:", e);
              }
            }

            // Mark workflow as needing attention (error status)
            // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
            try {
              await this.api.scriptStore.updateWorkflowFields(workflow.id, {
                status: "error",
              });
            } catch (e) {
              this.debug("updateWorkflow error", e);
            }

            // Signal that we're done (no retry) but user needs to act
            this.emitSignal({
              type: "needs_attention",
              workflowId: workflow.id,
              timestamp: Date.now(),
              error: errorMessage,
              errorType: classifiedError.type,
              scriptRunId,
            });
            break;

          case "network":
            // Network errors can self-heal - auto-retry with backoff
            this.debug("NETWORK: Scheduling retry for workflow", workflow.id);

            this.emitSignal({
              type: "retry",
              workflowId: workflow.id,
              timestamp: Date.now(),
              error: errorMessage,
              errorType: classifiedError.type,
              scriptRunId,
            });
            break;

          case "logic":
            // Logic errors go to agent for auto-fix via maintenance mode (spec 09b)
            this.debug("LOGIC: Script bug detected, entering maintenance mode for workflow", workflow.id);

            // Enter maintenance mode and route to planner for auto-fix
            try {
              await this.enterMaintenanceMode(
                workflow,
                script,
                scriptRunId,
                classifiedError,
                logs
              );
            } catch (e) {
              this.debug("Failed to enter maintenance mode:", e);
            }

            // Signal maintenance mode to scheduler
            this.emitSignal({
              type: "maintenance",
              workflowId: workflow.id,
              timestamp: Date.now(),
              error: errorMessage,
              errorType: classifiedError.type,
              scriptRunId,
            });
            break;
        }
      } else {
        // Unclassified error - signal retry to scheduler (fallback)
        this.debug("Unclassified error, scheduling retry:", errorMessage);
        this.emitSignal({
          type: "retry",
          workflowId: workflow.id,
          timestamp: Date.now(),
          error: errorMessage,
          scriptRunId,
        });
      }

      // Re-throw to let caller know about the error
      throw error;
    }
  }

  /**
   * Check logs for warnings and errors and send notification to task chat
   */
  private async checkLogsAndNotify(
    workflow: Workflow,
    scriptRunId: string,
    logs: string[]
  ): Promise<void> {
    if (!workflow.task_id) {
      this.debug("No task_id for workflow, skipping log check notification");
      return;
    }

    // Parse logs to find warnings and errors
    // Log format: [timestamp] PREFIX: 'message'
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const logLine of logs) {
      if (logLine.includes(" WARN: ")) {
        warnings.push(logLine);
      } else if (logLine.includes(" ERROR: ")) {
        errors.push(logLine);
      }
    }

    // If no warnings or errors, nothing to notify
    if (warnings.length === 0 && errors.length === 0) {
      return;
    }

    // Get the task to find the chat_id
    try {
      const task = await this.api.taskStore.getTask(workflow.task_id);
      
      if (!task.chat_id) {
        this.debug("No chat_id for task, skipping log check notification");
        return;
      }

      // Build the notification message
      let message = `Script run ${scriptRunId} had warnings or errors. Investigate them and make sure such cases are either fixed, or changed 'log'.`;
      
      if (warnings.length > 0) {
        message += `\n\nWarnings:\n${warnings.join("\n")}`;
      }
      
      if (errors.length > 0) {
        message += `\n\nErrors:\n${errors.join("\n")}`;
      }

      // Send the notification message to the task's chat
      await this.api.addMessage({
        chatId: task.chat_id,
        content: message,
        role: "user",
      });

      this.debug(
        "Sent log warning/error notification to chat",
        task.chat_id,
        "for script run",
        scriptRunId
      );
    } catch (error) {
      this.debug("Error sending log notification:", error);
    }
  }

  /**
   * Enter maintenance mode for a workflow when a logic error occurs.
   * This atomically creates a maintainer task for bounded script repair.
   *
   * If the fix count exceeds MAX_FIX_ATTEMPTS, escalates to user instead
   * of attempting another auto-fix (spec 09b).
   *
   * The maintainer task:
   * - Has its own thread_id (isolated from user chat)
   * - Has empty chat_id (does NOT write to user-facing chat)
   * - Will receive the script run context via inbox item
   */
  private async enterMaintenanceMode(
    workflow: Workflow,
    script: Script,
    scriptRunId: string,
    error: ClassifiedError,
    logs: string[]
  ): Promise<void> {
    // 1. Check if we've exceeded max fix attempts - escalate to user if so
    const currentFixCount = workflow.maintenance_fix_count || 0;
    if (currentFixCount >= MAX_FIX_ATTEMPTS) {
      this.debug(
        `Workflow ${workflow.id} has exceeded max fix attempts (${currentFixCount}/${MAX_FIX_ATTEMPTS}), escalating to user`
      );
      await this.escalateToUser(workflow, script, scriptRunId, error, logs, currentFixCount);
      return;
    }

    // 2. Atomically enter maintenance mode:
    //    - Increment fix count
    //    - Set maintenance flag
    //    - Create maintainer task
    //    - Create inbox item targeting the maintainer task
    const result = await this.api.enterMaintenanceMode({
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      scriptRunId: scriptRunId,
    });

    this.debug(
      `Entered maintenance mode for workflow ${workflow.id}, ` +
      `maintainer task ${result.maintainerTask.id}, ` +
      `fix attempt ${result.newFixCount}/${MAX_FIX_ATTEMPTS}`
    );

    // Note: No separate maintenance_started event needed (Spec 01)
    // Maintenance mode is internal state - UI can check workflow.maintenance flag
  }

  /**
   * Escalate a workflow to user after max fix attempts have been exceeded.
   * This pauses the workflow and notifies the user that manual intervention is needed.
   * Per spec 09b: "After N failed attempts, escalate to user and pause workflow"
   */
  private async escalateToUser(
    workflow: Workflow,
    script: Script,
    scriptRunId: string,
    error: ClassifiedError,
    logs: string[],
    fixAttempts: number
  ): Promise<void> {
    // 1. Set workflow to error status and reset fix count (gives user a fresh start)
    // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
    await this.api.scriptStore.updateWorkflowFields(workflow.id, {
      status: "error",  // Changed from 'disabled' to 'error' (Spec 11)
      maintenance: false, // Clear maintenance since we're not auto-fixing
      maintenance_fix_count: 0, // Reset so user gets fresh fix attempts when re-enabled
    });
    this.debug(`Workflow ${workflow.id} set to error status due to repeated fix failures`);

    // 2. Get the task and chat to notify user
    if (!workflow.task_id) {
      this.debug("No task_id for workflow, cannot notify user of escalation");
      return;
    }

    let task;
    try {
      task = await this.api.taskStore.getTask(workflow.task_id);
    } catch (e) {
      this.debug("Failed to get task for escalation:", e);
      return;
    }

    // 3. Create a notification for the escalation (Spec 01)
    try {
      await this.api.notificationStore.saveNotification({
        id: generateId(),
        workflow_id: workflow.id,
        type: 'escalated',
        payload: JSON.stringify({
          script_run_id: scriptRunId,
          error_type: error.type,
          error_message: error.message,
          fix_attempts: fixAttempts,
          max_fix_attempts: MAX_FIX_ATTEMPTS,
        }),
        timestamp: new Date().toISOString(),
        acknowledged_at: '',
        resolved_at: '',
        workflow_title: workflow.title,
      });
    } catch (e) {
      this.debug("Failed to save escalated notification:", e);
    }

    if (task.chat_id) {
      // 4. Send a user-facing message explaining the escalation
      const recentLogs = logs.slice(-20).join("\n");
      const escalationMessage = `**Automation Paused: Manual Intervention Required**

I've tried to automatically fix this workflow ${fixAttempts} times, but the same issue keeps occurring. I've paused the automation to prevent further problems.

**Error:** ${error.message}
**Error Type:** ${error.type}

**Recent Logs:**
\`\`\`
${recentLogs || "(no logs)"}
\`\`\`

**What you can do:**
1. Review the error and logs above
2. Check if there's a fundamental issue with the automation logic
3. Update the script manually if needed
4. Re-enable the automation when ready

If you'd like me to try fixing it again, just ask and I'll give it another go with fresh context.`;

      try {
        await this.api.addMessage({
          chatId: task.chat_id,
          content: escalationMessage,
          role: "assistant",
        });
      } catch (e) {
        this.debug("Failed to send escalation message:", e);
      }
    }

    // 5. Emit a signal so scheduler knows this workflow needs attention
    this.emitSignal({
      type: "needs_attention",
      workflowId: workflow.id,
      timestamp: Date.now(),
      error: `Auto-fix failed after ${fixAttempts} attempts: ${error.message}`,
      errorType: "logic",
      scriptRunId,
    });
  }

  private async createEnv(workflow: Workflow, sandbox: Sandbox, abortController?: AbortController) {
    // Create SandboxAPI directly without needing AgentEnv or dummy task
    const sandboxAPI = new SandboxAPI({
      api: this.api,
      type: "workflow",
      getContext: () => sandbox.context!,
      userPath: this.userPath,
      connectionManager: this.connectionManager,
      workflowId: workflow.id, // Enable pause checking during tool calls
      abortController, // Enable fatal error abort for invalid input
    });

    sandbox.setGlobal(await sandboxAPI.createGlobal());

    return sandboxAPI;
  }

  private async createSandbox(
    workflow: Workflow,
    scriptRunId: string,
    logs: string[],
    scriptId: string
  ) {
    // Sandbox
    const sandbox = await initSandbox();

    // Init context with cost tracking
    sandbox.context = {
      step: 0,
      taskId: workflow.task_id || workflow.id,
      taskRunId: undefined, // No task run for workflows
      scriptRunId,
      type: "workflow",
      taskThreadId: "", // Workflows don't have threads
      cost: 0, // Accumulated cost from tool calls (in dollars)
      createEvent: async (type: string, content: any, tx?: DBInterface) => {
        // Accumulate cost from events that have usage.cost (e.g., text_generate, images_generate)
        const eventCost = content?.usage?.cost;
        if (eventCost != null && typeof eventCost === 'number') {
          sandbox.context!.cost += eventCost;
        }
        // Convert cost from dollars to microdollars for storage
        const costMicrodollars = eventCost ? Math.ceil(eventCost * 1000000) : 0;

        // Save to execution_logs table (Spec 01)
        await this.api.executionLogStore.saveExecutionLog({
          id: generateId(),
          run_id: scriptRunId,
          run_type: 'script',
          event_type: 'tool_call',
          tool_name: type,
          input: JSON.stringify(content?.input || {}),
          output: JSON.stringify(content?.output || {}),
          error: content?.error || '',
          timestamp: new Date().toISOString(),
          cost: costMicrodollars,
        }, tx);
      },
      onLog: async (line: string) => {
        if (logs) {
          logs.push(line);
        }
      },
    };

    return sandbox;
  }
}
