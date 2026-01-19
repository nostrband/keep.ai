import { generateId } from "ai";
import { initSandbox, Sandbox } from "./sandbox/sandbox";
import debug from "debug";
import { KeepDbApi, Workflow, Script } from "@app/db";
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
  ErrorType,
} from "./errors";

// Maximum number of consecutive fix attempts before escalating to user (spec 09b)
// After this many failed auto-fix attempts, the workflow is paused and user is notified.
const MAX_FIX_ATTEMPTS = 3;

export interface WorkflowWorkerConfig {
  api: KeepDbApi;
  userPath?: string; // path to user files directory
  gmailOAuth2Client?: any; // Gmail OAuth2 client
  onSignal?: WorkflowSignalHandler; // Callback for scheduling signals
}

/**
 * WorkflowWorker executes individual workflows by running their associated scripts.
 * Use WorkflowScheduler for automatic workflow scheduling and retry management.
 */
export class WorkflowWorker {
  private api: KeepDbApi;
  private userPath?: string;
  public readonly gmailOAuth2Client?: any;
  private onSignal?: WorkflowSignalHandler;

  private debug = debug("agent:WorkflowWorker");

  constructor(config: WorkflowWorkerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.gmailOAuth2Client = config.gmailOAuth2Client;
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
   */
  public async executeWorkflow(
    workflow: Workflow,
    retryOf: string = '',
    retryCount: number = 0
  ): Promise<void> {
    this.debug("Execute workflow", workflow, "retryOf:", retryOf, "retryCount:", retryCount);

    try {
      // Find scripts by workflow_id
      const scripts = await this.api.scriptStore.getScriptsByWorkflowId(workflow.id);

      if (scripts.length === 0) {
        this.debug("No scripts found for workflow", workflow.id);
        throw new Error(`No scripts found for workflow ${workflow.id}`);
      }

      if (scripts.length > 1) {
        this.debug(`Warning: Multiple scripts (${scripts.length}) found for workflow ${workflow.id}, using latest version`);
      }

      // Use the latest script (first one, since getScriptsByWorkflowId orders by version DESC)
      const script = scripts[0];

      await this.processWorkflowScript(workflow, script, retryOf, retryCount);
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
    retryCount: number = 0
  ) {
    const scriptRunId = generateId();
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
      retryCount
    );

    await this.api.scriptStore.startScriptRun(
      scriptRunId,
      script.id,
      new Date().toISOString(),
      workflow.id,
      "workflow",
      retryOf,
      retryCount
    );

    // Initialize logs array for this script run
    const logs: string[] = [];

    // Declare sandbox outside try block so we can access cost in both success and error paths
    let sandbox: Sandbox | undefined;

    try {
      // JS sandbox with proper 'context' object
      sandbox = await this.createSandbox(
        workflow,
        scriptRunId,
        logs,
        script.id
      );

      // Inits JS API in the sandbox
      await this.createEnv(workflow, sandbox);

      // Run the code
      const result = await sandbox.eval(script.code, {
        timeoutMs: 300000,
      });

      if (result.ok) {
        this.debug("Script result", result.result);
      } else {
        this.debug("Script error", result.error);
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

      // Update workflow timestamp to mark last successful run
      // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
      await this.api.scriptStore.updateWorkflowFields(workflow.id, {
        timestamp: new Date().toISOString(),
      });

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
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      // Determine error_type for storage and notification filtering
      let errorType: ErrorType | '' = '';
      if (error === ERROR_BAD_REQUEST) {
        errorType = ''; // BAD_REQUEST is not a classified error type
      } else if (error === ERROR_PAYMENT_REQUIRED) {
        errorType = ''; // PAYMENT_REQUIRED is not a classified error type
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

      // Handle different error types based on classification
      if (error === ERROR_BAD_REQUEST) {
        this.debug("BAD_REQUEST: will not retry the workflow", workflow.id);

        // Mark workflow as error status
        // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
        try {
          await this.api.scriptStore.updateWorkflowFields(workflow.id, {
            status: "error",
          });
        } catch (e) {
          this.debug("updateWorkflow error", e);
        }

        // Signal success (no retry) to scheduler
        this.emitSignal({
          type: "done",
          workflowId: workflow.id,
          timestamp: Date.now(),
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
   * This sets the maintenance flag and sends the error context to the
   * planner task inbox for agent auto-fix.
   *
   * If the fix count exceeds MAX_FIX_ATTEMPTS, escalates to user instead
   * of attempting another auto-fix (spec 09b).
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

    // 2. Increment fix count and set maintenance flag
    const newFixCount = await this.api.scriptStore.incrementMaintenanceFixCount(workflow.id);
    await this.api.scriptStore.setWorkflowMaintenance(workflow.id, true);
    this.debug(
      `Maintenance mode enabled for workflow ${workflow.id}, fix attempt ${newFixCount}/${MAX_FIX_ATTEMPTS}`
    );

    // 3. Check if workflow has an associated planner task
    if (!workflow.task_id) {
      this.debug("No task_id for workflow, cannot route to planner inbox");
      return;
    }

    // 4. Get the planner task
    let task;
    try {
      task = await this.api.taskStore.getTask(workflow.task_id);
    } catch (e) {
      this.debug("Failed to get planner task:", e);
      return;
    }

    if (task.type !== "planner") {
      this.debug("Task is not a planner type, skipping inbox routing");
      return;
    }

    // 5. Build the maintenance message with error context for the agent
    const recentLogs = logs.slice(-50).join("\n"); // Last 50 log lines
    const maintenanceMessage = {
      type: "maintenance_request",
      workflow_id: workflow.id,
      workflow_title: workflow.title,
      script_run_id: scriptRunId,
      script_id: script.id,
      script_version: script.version,
      error: {
        type: error.type,
        message: error.message,
        source: error.source,
        stack: error.stack,
      },
      context: {
        script_code: script.code,
        recent_logs: recentLogs,
        change_comment: script.change_comment,
      },
      instructions: `A logic error occurred in your script. Please analyze the error and fix the script code.

Error Type: ${error.type}
Error Message: ${error.message}
${error.source ? `Error Source: ${error.source}` : ""}

Recent Logs:
${recentLogs || "(no logs)"}

Current Script Code:
\`\`\`javascript
${script.code}
\`\`\`

Please:
1. Analyze the error and understand what went wrong
2. Update the script code to fix the issue
3. Use the 'save' tool to save the fixed script

After saving the fix, the workflow will automatically exit maintenance mode and run again to verify the fix works.`,
    };

    // 6. Create inbox item to route to planner task
    const inboxId = `maintenance.${workflow.id}.${scriptRunId}.${generateId()}`;
    await this.api.inboxStore.saveInbox({
      id: inboxId,
      source: "script",
      source_id: scriptRunId,
      target: "planner",
      target_id: task.id,
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        role: "user",
        parts: [{
          type: "text",
          text: maintenanceMessage.instructions,
        }],
        metadata: {
          createdAt: new Date().toISOString(),
          maintenanceRequest: true,
          workflowId: workflow.id,
          scriptRunId: scriptRunId,
          errorType: error.type,
        },
      }),
      handler_thread_id: "",
      handler_timestamp: "",
    });

    this.debug("Maintenance request sent to planner inbox", inboxId);

    // 7. Create a chat event to show in the workflow chat
    if (task.chat_id) {
      try {
        await this.api.chatStore.saveChatEvent(
          generateId(),
          task.chat_id,
          "maintenance_started",
          {
            workflow_id: workflow.id,
            script_run_id: scriptRunId,
            error_type: error.type,
            error_message: error.message,
          }
        );
      } catch (e) {
        this.debug("Failed to save maintenance_started event:", e);
      }
    }
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
    // 1. Pause the workflow and reset fix count (gives user a fresh start)
    // Use updateWorkflowFields for atomic update to prevent overwriting concurrent changes
    await this.api.scriptStore.updateWorkflowFields(workflow.id, {
      status: "disabled",
      maintenance: false, // Clear maintenance since we're not auto-fixing
      maintenance_fix_count: 0, // Reset so user gets fresh fix attempts when re-enabled
    });
    this.debug(`Workflow ${workflow.id} paused due to repeated fix failures`);

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

    // 3. Create a chat event to show the escalation in the workflow chat
    if (task.chat_id) {
      try {
        await this.api.chatStore.saveChatEvent(
          generateId(),
          task.chat_id,
          "maintenance_escalated",
          {
            workflow_id: workflow.id,
            script_run_id: scriptRunId,
            error_type: error.type,
            error_message: error.message,
            fix_attempts: fixAttempts,
            max_fix_attempts: MAX_FIX_ATTEMPTS,
          }
        );
      } catch (e) {
        this.debug("Failed to save maintenance_escalated event:", e);
      }

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

  private async createEnv(workflow: Workflow, sandbox: Sandbox) {
    // Create SandboxAPI directly without needing AgentEnv or dummy task
    const sandboxAPI = new SandboxAPI({
      api: this.api,
      type: "workflow",
      getContext: () => sandbox.context!,
      userPath: this.userPath,
      gmailOAuth2Client: this.gmailOAuth2Client,
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
      createEvent: async (type: string, content: any, tx?: any) => {
        // Accumulate cost from events that have usage.cost (e.g., text_generate, images_generate)
        if (content?.usage?.cost != null && typeof content.usage.cost === 'number') {
          sandbox.context!.cost += content.usage.cost;
        }
        // set workflow fields
        content.workflow_id = workflow.id;
        content.script_run_id = scriptRunId;
        content.script_id = scriptId;
        // Send to main chat for now
        await this.api.chatStore.saveChatEvent(
          generateId(),
          "main",
          type,
          content,
          tx
        );
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
