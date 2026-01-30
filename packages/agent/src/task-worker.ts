import { generateId } from "ai";
import {
  getModelName,
  getOpenRouter,
  initSandbox,
  ReplAgent,
  Sandbox,
} from "./index";
import { AssistantUIMessage, AutonomyMode } from "@app/proto";
import debug from "debug";
import {
  DBInterface,
  InboxItem,
  KeepDbApi,
  Task,
  TaskType,
  formatVersion,
} from "@app/db";
import { AgentTask, MaintainerContext, StepOutput, StepReason } from "./agent-types";
import { AgentEnv } from "./agent-env";
import { SandboxAPI } from "./sandbox/api";
import { fileUtils } from "@app/node";
import { ERROR_BAD_REQUEST, ERROR_PAYMENT_REQUIRED } from "./agent";
import { TaskSignalHandler } from "./task-worker-signal";
import type { ConnectionManager } from "@app/connectors";

/**
 * Generate a concise title from the first user message.
 * Extracts text content and truncates to ~60 chars at word boundary.
 */
function generateTitleFromInbox(inbox: string[]): string | undefined {
  if (!inbox.length) return undefined;

  try {
    // Parse first inbox item
    const firstMessage = JSON.parse(inbox[0]);

    // Extract text from message parts
    let text = "";
    if (firstMessage.parts) {
      for (const part of firstMessage.parts) {
        if (part.type === "text" && part.text) {
          text += part.text + " ";
        }
      }
    } else if (typeof firstMessage === "string") {
      text = firstMessage;
    }

    text = text.trim();
    if (!text) return undefined;

    // Truncate at word boundary (max 60 chars)
    const maxLen = 60;
    if (text.length <= maxLen) return text;

    // Find last space before maxLen
    const truncated = text.substring(0, maxLen);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > 20) {
      // Truncate at word boundary if reasonable
      return truncated.substring(0, lastSpace) + "...";
    }

    // Otherwise just truncate with ellipsis
    return truncated.substring(0, maxLen - 3) + "...";
  } catch {
    return undefined;
  }
}

export interface TaskWorkerConfig {
  api: KeepDbApi;
  stepLimit?: number; // default 50
  userPath?: string; // path to user files directory
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
  onSignal?: TaskSignalHandler; // Callback for scheduling signals
}

/**
 * TaskWorker executes individual tasks.
 * Use TaskScheduler for automatic task scheduling and retry management.
 */
export class TaskWorker {
  private api: KeepDbApi;
  private stepLimit: number;
  private userPath?: string;
  public readonly connectionManager?: ConnectionManager;
  private onSignal?: TaskSignalHandler;

  private debug = debug("agent:TaskWorker");

  constructor(config: TaskWorkerConfig) {
    this.api = config.api;
    this.stepLimit = config.stepLimit || 50;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;
    this.onSignal = config.onSignal;
    this.debug("Constructed");
  }

  /**
   * Execute a single task.
   * This is the main entry point for task execution.
   */
  public async executeTask(task: Task): Promise<void> {
    this.debug("Execute task", task);

    try {
      // Type check to cast to TaskType safely
      if (task.type !== "worker" && task.type !== "planner" && task.type !== "maintainer") {
        this.debug("Unsupported task type", task.type);
        return this.finishTask(task, "Wrong type", "Unsupported task type");
      }
      const taskType: TaskType = task.type;

      // Fail fast: maintainer tasks require workflow_id to load context
      if (taskType === "maintainer" && !task.workflow_id) {
        this.debug("Maintainer task missing workflow_id");
        return this.finishTask(task, "Configuration error", "Maintainer task missing workflow_id");
      }

      const { inboxItems, inbox: rawInbox } = await this.getInboxItems(taskType, task.id);
      let inbox = rawInbox;
      
      // All tasks now require non-empty inbox (agentic loop only)
      if (!inbox.length) {
        if (task.state === "finished" || task.state === "error") {
          this.debug("Task already processed with state:", task.state);
          return;
        }
        this.debug("Empty task inbox - tasks only run as agentic loops now");
        return;
      }

      // =============================
      // Valid task, can start working

      // Initialize logs array for this task run
      const logs: string[] = [];
      const lastStepLogs: string[] = [];

      // We restore existing session on 'input' reason for worker,
      // bcs that generally means user is supplying
      // a followup message/question to latest worker reply
      let history: AssistantUIMessage[] = [];
      if ((taskType === "worker" || taskType === "planner" || taskType === "maintainer") && task.thread_id) {
        // Load existing history
        // NOTE: we start a new thread but copy history from
        // old thread, to make sure our observability traces
        // have separate threads for users to analyze
        history = await this.loadHistory(task.thread_id);
        this.debug(
          "Restoring task",
          task.id,
          "from thread",
          task.thread_id,
          "history",
          history.length
        );
      }

      // Reuse existing thread
      task.thread_id = task.thread_id || generateId();
      // Generate title from first inbox message if task doesn't have one
      await this.ensureThread(task, taskType, inbox);

      // Track asks locally (Spec 10: asks moved from task_states to tasks table)
      let currentAsks = task.asks || "";

      // Build maintainer context if needed
      let maintainerContext: MaintainerContext | undefined;
      if (taskType === "maintainer" && task.workflow_id) {
        maintainerContext = await this.loadMaintainerContext(
          task.workflow_id,
          inbox
        );
        if (!maintainerContext) {
          this.debug("Cannot create maintainer context - missing workflow or script");
          return this.finishTask(task, "Error", "Cannot load maintainer context");
        }
        // Enrich the inbox with the full maintainer context for the agent
        inbox = this.enrichMaintainerInbox(inbox, maintainerContext);
      }

      // Agent task (Spec 10: asks moved directly to AgentTask)
      const agentTask: AgentTask = {
        id: task.id,
        type: taskType,
        chat_id: task.chat_id,
        asks: currentAsks,
        maintainerContext,
      };

      // Model for agent
      const modelName = getModelName();

      // Start the run
      const { taskRunId, runStartTime } = await this.createTaskRun({
        agentTask,
        threadId: task.thread_id,
        chatId: task.chat_id,
        modelName,
        inbox,
      });

      // Sandbox
      const sandbox = await this.createSandbox(
        taskType,
        task,
        taskRunId,
        lastStepLogs
      );

      // Env
      const env = await this.createEnv(taskType, task, sandbox);

      // Init agent
      const model = getOpenRouter()(modelName, { usage: { include: true } });
      const agent = new ReplAgent(model, env, sandbox, agentTask, taskRunId);

      // Copy restored history
      agent.history.push(...history);

      try {
        // Helper
        const savedIds = new Set<string>();
        const saveNewMessages = async () => {
          const newMessages = agent.history.filter(
            (m) => !!m.parts && !savedIds.has(m.id)
          );
          this.debug("Save new messages", newMessages);
          await this.saveHistory(newMessages, task.thread_id);
          newMessages.forEach((m) => savedIds.add(m.id));
        };

        // Load JS state if reason is "input" or "timer"
        const jsState = await this.loadJsState(task.thread_id);

        // Use task.task as input message to the agent
        const result = await agent.loop(inbox, {
          jsState,
          getLogs: () => lastStepLogs.join("\n"),
          onStep: async (step, input, output, result) => {
            await saveNewMessages();

            // Move the logs
            logs.push(...lastStepLogs);
            lastStepLogs.length = 0;

            // Save JS state if available
            if (result?.ok && result.state) {
              await this.saveJsState(task.id, result.state);
            }

            return { proceed: step < this.stepLimit };
          },
        });
        this.debug(
          `Loop steps ${result?.steps} result ${JSON.stringify(result)}`
        );

        // Save task messages
        await saveNewMessages();

        // Sanity check
        if (!result) throw new Error("Bad result");
        if (result.kind === "code") throw new Error("Step limit exceeded");

        // Save wait state (Spec 10: only asks is used now)
        if (result.kind === "wait" && result.patch) {
          if (result.patch.asks !== undefined) {
            currentAsks = result.patch.asks;
            // Spec 10: Use updateTaskAsks instead of saveState
            await this.api.taskStore.updateTaskAsks(task.id, currentAsks);
          }
        }

        // Mark inbox items as finished
        await this.handleInboxItems(task, inboxItems);

        // Reply for replier & task run info
        const taskReply = this.formatTaskReply(result);

        // Prepare run end
        await this.finishTaskRun({
          taskId: task.id,
          taskRunId,
          runStartTime,
          result,
          currentAsks,
          taskReply,
          agent,
          chatId: task.chat_id,
          logs,
          toolCost: sandbox.context?.cost || 0,
        });

        // Update task in wait status
        if (result.kind === "wait") {
          this.debug(
            `Updating ${task.type || ""} task ${task.id} asks '${
              result.patch?.asks || ""
            }'`
          );

          await this.api.taskStore.updateTask({
            ...task,
            reply: result.reply || "",
            state: "asks",
            error: "",
            thread_id: task.thread_id,
          });

          this.debug(`Task updated`, {
            id: task.id,
            threadId: task.thread_id,
            asks: currentAsks,
          });
        } else {
          // Single-shot task finished
          await this.finishTask(task, taskReply, "");

          this.debug(`Task done:`, {
            reply: taskReply,
            threadId: task.thread_id,
          });
        }

        // Send reply/asks to recipient (replier inbox or user)
        // Maintainer tasks don't write to user chat - handle separately
        if (taskType === "maintainer" && maintainerContext) {
          await this.handleMaintainerCompletion(task, result, maintainerContext, agent);
        } else {
          await this.handleReply(taskType, task, currentAsks, result);
        }

        // Signal success to scheduler
        this.emitSignal({
          type: "done",
          taskId: task.id,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.debug("Task processing error:", error);

        // On exception, update the task with error and retry timestamp instead of finish+add
        const errorMessage =
          error instanceof Error ? error.message : (error as string);

        // Finish run with error
        await this.api.taskStore.errorTaskRun(
          taskRunId,
          new Date().toISOString(),
          errorMessage
        );

        // Not permanent error?
        if (error !== ERROR_BAD_REQUEST) {
          // Update the current task
          try {
            await this.api.taskStore.updateTask({
              ...task,
              reply: "",
              state: "", // Keep state empty so it can be retried
              error: errorMessage, // Set the error message
              thread_id: task.thread_id,
            });
          } catch (e) {
            this.debug("updateTask error", e);
          }

          // Signal retry to scheduler
          this.emitSignal({
            type: "retry",
            taskId: task.id,
            timestamp: Date.now(),
            error: errorMessage,
          });
        } else {
          this.debug("BAD_REQUEST: will not retry the task", task.id);

          // Make sure this inbox item is cleared
          // so that task isn't retried
          await this.handleInboxItems(task, inboxItems);

          // Set error on current task
          await this.finishTask(
            task,
            "Failed to process, bad request.",
            "Bad LLM request"
          );

          // Signal success (no retry) to scheduler
          this.emitSignal({
            type: "done",
            taskId: task.id,
            timestamp: Date.now(),
          });
        }

        // Provider low balance - requires user to add credits/upgrade plan
        if (error === ERROR_PAYMENT_REQUIRED) {
          const pauseUntilMs = Date.now() + 10 * 60 * 1000; // 10 minutes from now
          this.debug(
            `PAYMENT_REQUIRED: Sending global pause signal until ${new Date(
              pauseUntilMs
            ).toISOString()}`
          );

          // Set needAuth flag since payment required usually means re-authentication needed
          try {
            await this.api.setNeedAuth(true, "payment_required");
            this.debug("Set needAuth flag due to payment required");
          } catch (e) {
            this.debug("Error setting needAuth flag:", e);
          }

          // Signal global pause to scheduler
          this.emitSignal({
            type: "payment_required",
            taskId: task.id,
            timestamp: Date.now(),
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      this.debug("Task handling error:", error);
      throw error;
    }
  }

  /**
   * Emit a signal to the scheduler (if callback is provided)
   */
  private emitSignal(signal: Parameters<TaskSignalHandler>[0]): void {
    if (this.onSignal) {
      try {
        this.onSignal(signal);
      } catch (error) {
        this.debug("Error in signal handler:", error);
      }
    }
  }

  private async saveJsState(taskId: string, state: any): Promise<void> {
    if (!this.userPath) return;

    try {
      const stateDir = fileUtils.join(this.userPath, "state");
      if (!fileUtils.existsSync(stateDir)) {
        fileUtils.mkdirSync(stateDir, { recursive: true });
      }

      const stateFile = fileUtils.join(stateDir, `${taskId}.json`);
      fileUtils.writeFileSync(stateFile, JSON.stringify(state), "utf8");
      this.debug(`Saved JS state for task ${taskId} to ${stateFile}`);
    } catch (error) {
      this.debug(`Failed to save JS state for task ${taskId}:`, error);
    }
  }

  private async loadJsState(threadId: string): Promise<any | undefined> {
    if (!this.userPath) return undefined;

    try {
      const stateFile = fileUtils.join(
        this.userPath,
        "state",
        `${threadId}.json`
      );
      if (!fileUtils.existsSync(stateFile)) {
        this.debug(`No JS state file found for thread ${threadId}`);
        return undefined;
      }

      const stateContent = fileUtils.readFileSync(stateFile, "utf8") as string;
      const state = JSON.parse(stateContent);
      this.debug(`Loaded JS state for thread ${threadId} from ${stateFile}`);
      return state;
    } catch (error) {
      this.debug(`Failed to load JS state for thread ${threadId}:`, error);
      return undefined;
    }
  }

  private async handleReply(
    taskType: TaskType,
    task: Task,
    currentAsks: string,
    result: StepOutput
  ) {
    if (result.kind === "code") throw new Error("Can't handle 'code' reply");

    // Send reply after all done
    if (result.reply) {
      await this.sendToUser(task.chat_id, result.reply);
    }

    // We ran an iteration and still have asks?
    // Send to replier
    if (result.kind === "wait" && currentAsks) {
      await this.sendToUser(task.chat_id, currentAsks);
    }
  }

  /**
   * Load rich context for maintainer task from the failed script run.
   * Extracts scriptRunId from inbox, loads the failed run, script, and builds changelog.
   */
  private async loadMaintainerContext(
    workflowId: string,
    inbox: string[]
  ): Promise<MaintainerContext | undefined> {
    // 1. Get the workflow and active script for version info
    const workflow = await this.api.scriptStore.getWorkflow(workflowId);
    if (!workflow || !workflow.active_script_id) {
      this.debug("loadMaintainerContext: No workflow or active script");
      return undefined;
    }

    const activeScript = await this.api.scriptStore.getScript(workflow.active_script_id);
    if (!activeScript) {
      this.debug("loadMaintainerContext: Active script not found");
      return undefined;
    }

    // 2. Extract scriptRunId from first inbox item metadata
    let scriptRunId: string | undefined;
    for (const item of inbox) {
      try {
        const parsed = JSON.parse(item);
        if (parsed.metadata?.scriptRunId) {
          scriptRunId = parsed.metadata.scriptRunId;
          break;
        }
      } catch (e) {
        this.debug("loadMaintainerContext: Failed to parse inbox item", e);
      }
    }

    if (!scriptRunId) {
      // Fail fast: don't attempt blind fixes without knowing which script run failed
      // The planner may have updated the active script since the failure occurred
      this.debug("loadMaintainerContext: No scriptRunId found in inbox - cannot determine failed script");
      return undefined;
    }

    // 3. Load the failed script run
    const scriptRun = await this.api.scriptStore.getScriptRun(scriptRunId);
    if (!scriptRun) {
      this.debug("loadMaintainerContext: Script run not found", scriptRunId);
      return {
        workflowId,
        expectedMajorVersion: activeScript.major_version,
        scriptRunId,
        error: { type: "unknown", message: "Script run not found" },
        logs: "",
        scriptCode: activeScript.code,
        scriptVersion: formatVersion(activeScript.major_version, activeScript.minor_version),
        changelog: [],
      };
    }

    // 4. Load the script that was run (might be different from current active script)
    const failedScript = await this.api.scriptStore.getScript(scriptRun.script_id);
    const scriptToUse = failedScript || activeScript;

    // 5. Build changelog from prior minor versions for the same major version
    const priorScripts = await this.api.scriptStore.getScriptsByWorkflowAndMajorVersion(
      workflowId,
      scriptToUse.major_version
    );
    const changelog = priorScripts
      .filter(s => s.minor_version < scriptToUse.minor_version)
      .sort((a, b) => b.minor_version - a.minor_version) // newest first
      .slice(0, 5) // limit to last 5 changes
      .map(s => ({
        version: formatVersion(s.major_version, s.minor_version),
        comment: s.change_comment || "",
      }));

    // 6. Trim logs to last 50 lines to avoid context bloat
    const allLogs = scriptRun.logs || "";
    const logLines = allLogs.split("\n");
    const trimmedLogs = logLines.length > 50
      ? logLines.slice(-50).join("\n")
      : allLogs;

    return {
      workflowId,
      expectedMajorVersion: scriptToUse.major_version,
      scriptRunId,
      error: {
        type: scriptRun.error_type || "unknown",
        message: scriptRun.error || "Unknown error",
      },
      logs: trimmedLogs,
      scriptCode: scriptToUse.code,
      scriptVersion: formatVersion(scriptToUse.major_version, scriptToUse.minor_version),
      changelog,
    };
  }

  /**
   * Enrich the inbox with full maintainer context for the agent.
   * Replaces the original "A logic error occurred" message with detailed context.
   */
  private enrichMaintainerInbox(
    inbox: string[],
    context: MaintainerContext
  ): string[] {
    // Build the rich context message for the maintainer agent
    const changelogText = context.changelog.length > 0
      ? context.changelog.map(c => `- v${c.version}: ${c.comment}`).join("\n")
      : "(no prior minor versions)";

    const contextMessage = `# Script Fix Request

A logic error occurred during script execution. Please analyze and fix the issue.

## Error Details
- **Type:** ${context.error.type}
- **Message:** ${context.error.message}

## Script Information
- **Version:** ${context.scriptVersion}
- **Workflow ID:** ${context.workflowId}

## Console Logs (last 50 lines)
\`\`\`
${context.logs || "(no logs)"}
\`\`\`

## Prior Fix Attempts (same major version)
${changelogText}

## Script Code
\`\`\`javascript
${context.scriptCode}
\`\`\`

---

Analyze the error, use \`eval\` to test hypotheses, and call \`fix\` with the corrected code.
If you cannot fix this issue autonomously, explain why without calling the \`fix\` tool.`;

    // Create a new inbox message with the rich context
    const enrichedMessage = JSON.stringify({
      role: "user",
      parts: [{ type: "text", text: contextMessage }],
      metadata: {
        scriptRunId: context.scriptRunId,
        maintainerContext: true,
      },
    });

    return [enrichedMessage];
  }

  /**
   * Handle completion of a maintainer task.
   * Checks if the fix tool was called and handles various outcomes:
   * - Fix applied: workflow will re-run automatically (set by fix tool)
   * - Fix not applied (race condition): planner updated script, maintainer fix is stale
   * - Fix not called: maintainer couldn't fix, escalate to user with explanation
   */
  private async handleMaintainerCompletion(
    task: Task,
    result: StepOutput,
    context: MaintainerContext,
    agent: ReplAgent
  ): Promise<void> {
    // Check if fix tool was called by looking at agent history
    const fixCalled = this.checkIfFixToolCalled(agent);
    this.debug("Maintainer completion - fix called:", fixCalled);

    if (fixCalled) {
      // Fix was attempted - the fix tool handles updating workflow
      // Check if it was actually applied by checking workflow state
      const workflow = await this.api.scriptStore.getWorkflow(context.workflowId);
      if (workflow && !workflow.maintenance) {
        // Maintenance flag was cleared - either fix applied or race condition handled
        this.debug("Maintainer fix processed, maintenance flag cleared");
        return;
      }
      // If maintenance is still set, something went wrong - clear it
      if (workflow?.maintenance) {
        await this.api.scriptStore.updateWorkflowFields(context.workflowId, {
          maintenance: false,
        });
      }
      return;
    }

    // Fix was NOT called - maintainer couldn't fix the issue
    // Escalate to user with maintainer's explanation
    this.debug("Maintainer did not call fix tool - escalating to user");

    const explanation = this.getLastAssistantMessage(agent);
    await this.escalateMaintainerFailure(
      context.workflowId,
      context.scriptRunId,
      explanation || "The maintainer was unable to automatically fix this issue."
    );
  }

  /**
   * Check if the fix tool was called during the agent loop.
   * Looks through agent history for tool parts with type 'tool-fix'.
   */
  private checkIfFixToolCalled(agent: ReplAgent): boolean {
    for (const message of agent.history) {
      if (message.role !== "assistant" || !message.parts) continue;
      for (const part of message.parts) {
        // The AI SDK uses `tool-${toolName}` format for tool parts
        if (part.type === "tool-fix") {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Extract the last assistant text message from agent history.
   * Used to get maintainer's explanation when it cannot fix an issue.
   */
  private getLastAssistantMessage(agent: ReplAgent): string | undefined {
    for (let i = agent.history.length - 1; i >= 0; i--) {
      const message = agent.history[i];
      if (message.role !== "assistant" || !message.parts) continue;
      for (const part of message.parts) {
        if (part.type === "text" && part.text) {
          return part.text;
        }
      }
    }
    return undefined;
  }

  /**
   * Escalate a maintainer failure to the user.
   * Sets workflow to error status and creates a notification with the explanation.
   */
  private async escalateMaintainerFailure(
    workflowId: string,
    scriptRunId: string,
    explanation: string
  ): Promise<void> {
    // Get workflow info
    const workflow = await this.api.scriptStore.getWorkflow(workflowId);
    if (!workflow) {
      this.debug("escalateMaintainerFailure: workflow not found", workflowId);
      return;
    }

    // Set workflow to error status and clear maintenance
    await this.api.scriptStore.updateWorkflowFields(workflowId, {
      status: "error",
      maintenance: false,
      maintenance_fix_count: 0, // Reset so user gets fresh attempts
    });

    // Create notification with explanation and Re-plan action
    try {
      await this.api.notificationStore.saveNotification({
        id: generateId(),
        workflow_id: workflowId,
        type: "maintenance_failed",
        payload: JSON.stringify({
          script_run_id: scriptRunId,
          explanation: explanation,
        }),
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: workflow.title,
      });
    } catch (e) {
      this.debug("Failed to save maintenance_failed notification:", e);
    }

    // If workflow has an associated task with chat, send explanation to user
    if (workflow.task_id) {
      try {
        const task = await this.api.taskStore.getTask(workflow.task_id);
        if (task.chat_id) {
          const message = `**Auto-fix Failed**

I attempted to automatically fix this workflow but couldn't resolve the issue.

**My analysis:**
${explanation}

**What you can do:**
1. Review the error details in the workflow history
2. Make changes to the script or workflow configuration
3. Re-enable the automation when ready

If you'd like me to try a different approach, just let me know!`;

          await this.api.addMessage({
            chatId: task.chat_id,
            content: message,
            role: "assistant",
          });
        }
      } catch (e) {
        this.debug("Failed to send escalation message to chat:", e);
      }
    }

    // Emit signal for scheduler
    this.emitSignal({
      type: "done",
      taskId: workflow.task_id || workflowId,
      timestamp: Date.now(),
    });
  }

  private async createTaskRun(opts: {
    agentTask: AgentTask;
    threadId: string;
    chatId: string;
    modelName: string;
    inbox: string[];
  }) {
    const taskRunId = generateId();
    const runStartTime = new Date();
    // Spec 10: input_goal, input_notes, input_plan are deprecated (always empty)
    await this.api.taskStore.createTaskRun({
      id: taskRunId,
      task_id: opts.agentTask.id,
      thread_id: opts.threadId,
      start_timestamp: runStartTime.toISOString(),
      type: opts.agentTask.type,
      model: opts.modelName,
      reason: "input",
      inbox: JSON.stringify(opts.inbox),
      input_asks: opts.agentTask.asks || "",
      input_goal: "",
      input_plan: "",
      input_notes: "",
    });

    // Log run start to execution_logs (Spec 01)
    await this.api.executionLogStore.saveExecutionLog({
      id: generateId(),
      run_id: taskRunId,
      run_type: 'task',
      event_type: 'run_start',
      tool_name: '',
      input: JSON.stringify({ task_id: opts.agentTask.id }),
      output: '',
      error: '',
      timestamp: runStartTime.toISOString(),
      cost: 0,
    });

    return {
      taskRunId,
      runStartTime,
    };
  }

  private async handleInboxItems(task: Task, inboxItems: InboxItem[]) {
    const now = new Date().toISOString();
    for (const item of inboxItems)
      await this.api.inboxStore.handleInboxItem(item.id, now, task.thread_id);
  }

  private async finishTaskRun(opts: {
    taskId: string;  // Spec 10: taskId passed explicitly
    taskRunId: string;
    runStartTime: Date;
    result: StepOutput;
    currentAsks: string;  // Spec 10: asks passed directly instead of TaskState
    taskReply: string;
    agent: ReplAgent;
    chatId: string;
    logs: string[];
    toolCost: number; // Tool execution cost in dollars from sandbox.context.cost
  }) {
    const runEndTime = new Date();
    const usage = opts.agent.usage;
    // Combine agent LLM orchestration costs with tool execution costs
    const agentCostDollars = opts.agent.openRouterUsage.cost || 0;
    const totalCostDollars = agentCostDollars + opts.toolCost;
    // Spec 10: output_goal, output_notes, output_plan are deprecated (always empty)
    await this.api.taskStore.finishTaskRun({
      id: opts.taskRunId,
      run_sec: Math.floor(
        (runEndTime.getTime() - opts.runStartTime.getTime()) / 1000
      ),
      end_timestamp: runEndTime.toISOString(),
      steps: opts.result.steps,
      state: opts.result.kind,
      output_asks: opts.currentAsks || "",
      output_goal: "",
      output_plan: "",
      output_notes: "",
      reply: opts.taskReply,
      input_tokens: usage.inputTokens || 0,
      cached_tokens: usage.cachedInputTokens || 0,
      output_tokens: (usage.outputTokens || 0) + (usage.reasoningTokens || 0),
      cost: Math.ceil(totalCostDollars * 1000000),
      logs: opts.logs.join("\n"),
    });

    // Log run end to execution_logs (Spec 01)
    await this.api.executionLogStore.saveExecutionLog({
      id: generateId(),
      run_id: opts.taskRunId,
      run_type: 'task',
      event_type: 'run_end',
      tool_name: '',
      input: '',
      output: JSON.stringify({
        task_id: opts.taskId,
        usage: opts.agent.openRouterUsage,
      }),
      error: '',
      timestamp: runEndTime.toISOString(),
      cost: Math.ceil(totalCostDollars * 1000000),
    });
  }

  private async createEnv(taskType: TaskType, task: Task, sandbox: Sandbox) {
    // Create SandboxAPI for the JS sandbox
    const sandboxAPI = new SandboxAPI({
      api: this.api,
      type: taskType,
      getContext: () => sandbox.context!,
      userPath: this.userPath,
      connectionManager: this.connectionManager,
    });

    sandbox.setGlobal(await sandboxAPI.createGlobal());

    // Get user's autonomy preference for agent behavior
    // Fallback to 'ai_decides' if DB query fails - autonomy mode is a preference, not critical
    let autonomyMode: AutonomyMode = 'ai_decides';
    try {
      autonomyMode = await this.api.getAutonomyMode();
    } catch (error) {
      this.debug('Failed to get autonomy mode, using default ai_decides:', error);
    }

    // Fetch connected accounts for agent context
    // Allows agent to know available service-account pairs upfront
    const connections = this.connectionManager
      ? await this.connectionManager.listConnections()
      : [];

    // Still create AgentEnv for system prompts, context building, etc.
    const env = new AgentEnv(
      this.api,
      taskType,
      task,
      sandboxAPI.tools,
      this.userPath,
      autonomyMode,
      connections,
    );

    return env;
  }

  private async createSandbox(
    taskType: TaskType,
    task: Task,
    taskRunId?: string,
    logs?: string[]
  ) {
    // Sandbox
    const sandbox = await initSandbox();

    // Init context
    sandbox.context = {
      step: 0,
      taskId: task.id,
      taskRunId,
      scriptRunId: undefined, // No script runs for tasks anymore
      type: taskType,
      taskThreadId: task.thread_id,
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
          run_id: taskRunId || '',
          run_type: 'task',
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

  private async getInboxItems(
    taskType: TaskType,
    taskId: string
  ): Promise<{
    inboxItems: InboxItem[];
    inbox: string[];
  }> {
    const inboxItems = (
      await this.api.inboxStore.listInboxItems({
        target: taskType,
        handled: false,
      })
    ).filter((i) => !i.target_id || i.target_id === taskId);

    const inbox: string[] = inboxItems
      .map((i) => {
        try {
          const message = JSON.parse(i.content);
          return JSON.stringify({
            ...message,
            id: i.id,
          });
        } catch (e) {
          console.warn("Failed to parse inbox item:", i.id, e);
          return undefined;
        }
      })
      .filter((x): x is string => x !== undefined);

    return {
      inboxItems,
      inbox,
    };
  }

  private async finishTask(
    task: Task,
    reply: string,
    error: string = ""
  ): Promise<void> {
    await this.api.taskStore.finishTask(task.id, task.thread_id, reply, error);
  }

  private async ensureThread(task: Task, taskType: TaskType, inbox: string[]) {
    const threadId = task.thread_id;

    // Use task title, or generate from inbox content, or fall back to task type
    let title: string | undefined = task.title;
    if (!title) {
      title = generateTitleFromInbox(inbox);
    }
    if (!title) {
      title = taskType === "worker" ? "Worker" : taskType === "planner" ? "Planner" : "Maintainer";
    }

    const now = new Date();
    let thread = await this.api.memoryStore.getThread(threadId);
    if (!thread) {
      thread = {
        id: threadId,
        created_at: now,
        updated_at: now,
        title,
      };
      await this.api.memoryStore.saveThread(thread);
    }
  }

  private async loadHistory(threadId: string) {
    return await this.api.memoryStore.getMessages({
      threadId,
      limit: 100,
    });
  }

  private async saveHistory(history: AssistantUIMessage[], threadId: string) {
    await this.api.memoryStore.saveMessages(
      history.map((m) => {
        const am: AssistantUIMessage = {
          ...m,
          metadata: {
            ...m.metadata!,
            threadId,
          },
        };
        return am;
      })
    );
  }

  private formatTaskReply(result: StepOutput) {
    if (result.kind === "code") throw new Error("Wrong task kind for reply");
    return `===REASONING===
${result.reasoning || ""}
===REPLY===
${result.reply || ""}
`;
  }

  private async sendToUser(chat_id: string, reply: string, taskRunId?: string) {
    this.debug("Save user reply", reply);

    const messageId = generateId();
    const timestamp = new Date().toISOString();

    // Build message content in AssistantUIMessage format
    const messageContent = JSON.stringify({
      id: messageId,
      role: "assistant",
      metadata: {
        createdAt: timestamp,
        threadId: chat_id,
      },
      parts: [
        {
          type: "text",
          text: reply,
        },
      ],
    });

    // Save to chat_messages table with metadata (Spec 01)
    await this.api.chatStore.saveChatMessage({
      id: messageId,
      chat_id: chat_id,
      role: 'assistant',
      content: messageContent,
      timestamp: timestamp,
      task_run_id: taskRunId || '',
      script_id: '',
      failed_script_run_id: '',
    });
  }
}
