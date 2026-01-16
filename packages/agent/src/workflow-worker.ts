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
   */
  public async executeWorkflow(workflow: Workflow): Promise<void> {
    this.debug("Execute workflow", workflow);

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

      await this.processWorkflowScript(workflow, script);
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
    script: Script
  ) {
    const scriptRunId = generateId();
    this.debug(
      "Running script run",
      scriptRunId,
      "script",
      script.id,
      "workflow",
      workflow.id
    );

    await this.api.scriptStore.startScriptRun(
      scriptRunId,
      script.id,
      new Date().toISOString(),
      workflow.id,
      "workflow"
    );

    // Initialize logs array for this script run
    const logs: string[] = [];

    try {
      // JS sandbox with proper 'context' object
      const sandbox = await this.createSandbox(
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

      // Workflow script finished ok
      await this.api.scriptStore.finishScriptRun(
        scriptRunId,
        new Date().toISOString(),
        JSON.stringify(result.result) || "",
        "",
        logs.join("\n")
      );

      // Update workflow timestamp to mark last successful run
      await this.api.scriptStore.updateWorkflow({
        ...workflow,
        timestamp: new Date().toISOString(),
      });

      // Check for warnings or errors in logs and notify
      await this.checkLogsAndNotify(workflow, scriptRunId, logs);

      // Signal success to scheduler
      this.emitSignal({
        type: "done",
        workflowId: workflow.id,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      try {
        await this.api.scriptStore.finishScriptRun(
          scriptRunId,
          new Date().toISOString(),
          "",
          errorMessage,
          logs.join("\n")
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
        try {
          await this.api.scriptStore.updateWorkflow({
            ...workflow,
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
        });
      } else if (error === ERROR_PAYMENT_REQUIRED) {
        this.debug("PAYMENT_REQUIRED: Sending global pause signal");

        // Signal global pause to scheduler
        this.emitSignal({
          type: "payment_required",
          workflowId: workflow.id,
          timestamp: Date.now(),
          error: errorMessage,
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
            try {
              await this.api.scriptStore.updateWorkflow({
                ...workflow,
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
            });
            break;

          case "logic":
            // Logic errors should go to agent for auto-fix (maintenance mode)
            // For now, treat as retry - maintenance mode implementation is separate
            this.debug("LOGIC: Script bug detected, scheduling retry for workflow", workflow.id);

            // TODO: Implement maintenance mode (spec 09b)
            // - Set workflow.maintenance = true
            // - Route error to planner task inbox
            // - Agent analyzes and generates fix
            // - On fix: clear maintenance flag, re-run immediately

            this.emitSignal({
              type: "retry",
              workflowId: workflow.id,
              timestamp: Date.now(),
              error: errorMessage,
              errorType: classifiedError.type,
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

    // Init context
    sandbox.context = {
      step: 0,
      taskId: workflow.task_id || workflow.id,
      taskRunId: undefined, // No task run for workflows
      scriptRunId,
      type: "workflow",
      taskThreadId: "", // Workflows don't have threads
      createEvent: async (type: string, content: any, tx?: any) => {
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
