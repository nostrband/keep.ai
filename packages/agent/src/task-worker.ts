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
} from "@app/db";
import { AgentTask, StepOutput, StepReason } from "./agent-types";
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
      if (task.type !== "worker" && task.type !== "planner") {
        this.debug("Unsupported task type", task.type);
        return this.finishTask(task, "Wrong type", "Unsupported task type");
      }
      const taskType: TaskType = task.type;

      const { inboxItems, inbox } = await this.getInboxItems(taskType, task.id);
      
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
      if ((taskType === "worker" || taskType === "planner") && task.thread_id) {
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

      // Agent task (Spec 10: asks moved directly to AgentTask)
      const agentTask: AgentTask = {
        id: task.id,
        type: taskType,
        chat_id: task.chat_id,
        asks: currentAsks,
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
        await this.handleReply(taskType, task, currentAsks, result);

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

    // Still create AgentEnv for system prompts, context building, etc.
    const env = new AgentEnv(
      this.api,
      taskType,
      task,
      sandboxAPI.tools,
      this.userPath,
      autonomyMode,
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
      title = taskType === "worker" ? "Worker" : "Planner";
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
