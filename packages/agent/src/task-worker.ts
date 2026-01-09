import { generateId, StepResult } from "ai";
import {
  getModelName,
  getOpenRouter,
  initSandbox,
  ReplAgent,
  Sandbox,
} from "./index";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";
import {
  DBInterface,
  InboxItem,
  InboxItemTarget,
  KeepDbApi,
  MAX_STATUS_TTL,
  Script,
  Task,
  TaskState,
} from "@app/db";
import { AgentTask, StepOutput, StepReason, TaskType } from "./agent-types";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { AgentEnv } from "./agent-env";
import { isValidEnv } from "./env";
import { Cron } from "croner";
import { fileUtils } from "@app/node";
import { ERROR_BAD_REQUEST, ERROR_PAYMENT_REQUIRED } from "./agent";

export interface TaskWorkerConfig {
  api: KeepDbApi;
  stepLimit?: number; // default 50
  userPath?: string; // path to user files directory
  gmailOAuth2Client?: any; // Gmail OAuth2 client
}

interface TaskRetryState {
  nextStart: number; // timestamp in milliseconds when task can be retried
  retryCount: number; // number of retry attempts
}

export class TaskWorker {
  private api: KeepDbApi;
  private stepLimit: number;
  private userPath?: string;
  public readonly gmailOAuth2Client?: any;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  // Task state map for retry backoff (reset on program restart)
  private taskRetryState: Map<string, TaskRetryState> = new Map();

  // Global pause for PAYMENT_REQUIRED errors
  private globalPauseUntil: number = 0;

  private debug = debug("agent:TaskWorker");

  constructor(config: TaskWorkerConfig) {
    this.api = config.api;
    this.stepLimit = config.stepLimit || 50;
    this.userPath = config.userPath;
    this.gmailOAuth2Client = config.gmailOAuth2Client;
    this.debug("Constructed");
  }

  async close(): Promise<void> {
    if (!this.isRunning) return;
    this.isShuttingDown = true;
    if (this.interval) clearInterval(this.interval);
  }

  public start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.checkWork(), 10000);

    // check immediately
    this.checkWork();
  }

  public async checkWork(): Promise<void> {
    if (!isValidEnv()) {
      this.debug("No api keys or invalid env config");
      return;
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
      // Auto-create router and replier tasks,
      // get task ids that have incoming mail
      const items = await this.checkInbox();

      // Any tasks?
      processed = await this.processNextTask(items);
    } catch (e) {
      console.error("Error processing task", e);
    }

    // Done
    this.isRunning = false;

    // Retry immediately in case more jobs might be incoming
    if (processed) this.checkWork();
  }

  private async checkInbox() {
    try {
      const items = await this.api.inboxStore.listInboxItems({
        handled: false,
      });
      this.debug("Inbox items", items.length, "targets", [
        ...new Set(items.map((i) => i.target)),
      ]);

      const ensureTask = async (type: InboxItemTarget) => {
        const typeItems = items.filter((i) => i.target === type);
        this.debug("Inbox items", typeItems.length, "target", type);
        if (typeItems.length > 0) {
          await this.ensureTask(type);
        }
      };

      await ensureTask("router");
      await ensureTask("replier");

      return items;
    } catch (err) {
      this.debug("checkInbox error:", err);
      return [];
    }
  }

  private async processNextTask(inboxItems: InboxItem[]): Promise<boolean> {
    let task: Task | undefined;
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

      // Get tasks with expired timers and with non-empty inboxes
      const todoTasks = await this.api.taskStore.getTodoTasks();
      if (inboxItems.find((i) => i.target === "router"))
        todoTasks.push(
          ...(await this.api.taskStore.listTasks(false, "router"))
        );

      // Turn off the replier
      // if (inboxItems.find((i) => i.target === "replier"))
      //   todoTasks.push(
      //     ...(await this.api.taskStore.listTasks(false, "replier"))
      //   );

      const receiverIds = inboxItems
        .map((i) => i.target_id)
        .filter((id) => !!id);
      const receiverTasks =
        receiverIds.length > 0
          ? await this.api.taskStore.getTasks(receiverIds)
          : [];

      // Dedup tasks
      const taskMap = new Map<string, Task>();
      todoTasks.map((t) => taskMap.set(t.id, t));
      receiverTasks.map((t) => taskMap.set(t.id, t));

      // Filter out tasks that are in retry backoff
      const currentTime = Date.now();
      const availableTasks = [...taskMap.values()].filter((t) => {
        const retryState = this.taskRetryState.get(t.id);
        if (retryState && retryState.nextStart > currentTime) {
          this.debug(
            `Skipping task ${t.id} in backoff until ${new Date(
              retryState.nextStart
            ).toISOString()}`
          );
          return false;
        }
        return true;
      });

      // Uniq tasks array, sorted by timestamp asc
      const tasks = availableTasks.sort((a, b) => a.timestamp - b.timestamp);
      this.debug("Pending tasks", tasks);

      // Find highest-priority task:
      // - router - top
      task = tasks.find((t) => t.type === "router");
      // - replier after router - next
      if (!task)
        task = tasks.find(
          (t) =>
            t.type === "replier" &&
            inboxItems.find(
              (i) => i.source === "router" && i.target === "replier"
            )
        );
      // - planner
      if (!task) task = tasks.find((t) => t.type === "planner");
      // - worker
      if (!task) task = tasks.find((t) => t.type === "worker");
      // - replier after worker
      if (!task) task = tasks.find((t) => t.type === "replier");

      // Found anything?
      if (task) {
        this.debug(
          `triggering task at ${new Date(
            task.timestamp * 1000
          ).toISOString()}: ${task.task}`
        );

        try {
          await this.processTask(task);
        } catch (error) {
          this.debug("failed to process task:", error);
        }
      }
    } catch (err) {
      this.debug("checkTasks error:", err);
    }

    return !!task;
  }

  /**
   * Task states per type:
   * - router/replier (isPersistentTask):
   *  - if no task with state not in ('finished', 'error) - created
   *  - can't return asks/wait
   *  - when done state set to 'asks' and timestamp made current
   * - worker single-shot:
   *  - started when timestamp < now or if 'wait'/'asks' state and inbox is not empty
   *  - if returns 'wait' => is asks not empty state = 'asks' else state = 'wait'
   *  - timestamp set to resumeAt if returns 'wait'
   * - worker recurring:
   *  - started by same logic as single-shot
   *  - same handling of 'wait' return status
   *  - if returns 'done' then task state set to '' (new task) and timestamp set to cron next run
   */
  private async processTask(task: Task): Promise<void> {
    this.debug("Process task", task);

    let statusUpdaterInterval: ReturnType<typeof setInterval> | undefined;
    try {
      // Type check to cast to TaskType safely
      if (
        task.type !== "worker" &&
        task.type !== "planner" &&
        task.type !== "router" &&
        task.type !== "replier"
      ) {
        this.debug("Unsupported task type", task.type);
        return this.finishTask(task, "Wrong type", "Unsupported task type");
      }
      const taskType: TaskType = task.type;

      const { inboxItems, inbox } = await this.getInboxItems(taskType, task.id);
      if (taskType !== "worker" && taskType !== "planner" && !inbox.length) {
        this.debug("Empty task inbox", task.type, task.id);
        return this.finishTask(task, "Empty inbox", "Empty inbox");
      }

      if (!inbox.length) {
        if (task.state === "finished" || task.state === "error") {
          this.debug("Task already processed with state:", task.state);
          return;
        }
      }

      // Running a script?
      if (taskType === "planner" && !inbox.length) {
        const script = await this.api.scriptStore.getLatestScriptByTaskId(
          task.id
        );
        if (script) {
          return await this.processTaskScript(task, taskType, script);
        }
      }

      // =============================
      // Valid task, can start working

      // Initialize logs array for this task run
      const logs: string[] = [];
      const lastStepLogs: string[] = [];

      // Set agent status in db
      statusUpdaterInterval = await this.startStatusUpdater(taskType);

      // Run reason
      let reason: "start" | "input" | "timer" = "start";
      if (task.state !== "") reason = inbox.length > 0 ? "input" : "timer";

      // We restore existing session on 'input' reason for worker,
      // bcs that generally means user is supplying
      // a followup message/question to latest worker reply
      let history: AssistantUIMessage[] = [];
      if (
        (taskType === "worker" || taskType === "planner") &&
        reason === "input" &&
        task.thread_id
      ) {
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

      // New thread for each new 'start' reason
      task.thread_id = generateId();
      // Placeholder, FIXME add title?
      await this.ensureThread(task.thread_id, taskType);

      // Get task state
      const state = await this.getTaskState(task);

      // Agent task
      const agentTask: AgentTask = {
        id: task.id,
        type: taskType,
        state: {
          ...state,
        },
      };

      // Model for agent
      const modelName = getModelName();

      // Start the run
      const { taskRunId, runStartTime } = await this.createTaskRun(
        agentTask,
        task.thread_id,
        modelName,
        reason,
        inbox
      );

      // Sandbox
      const sandbox = await this.createSandbox(taskType, task, taskRunId, undefined, lastStepLogs);

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
        let jsState: any = undefined;
        if (reason === "input" || reason === "timer") {
          jsState = await this.loadJsState(task.id);
        }

        // Use task.task as input message to the agent
        const result = await agent.loop(reason, {
          // Pass the input text to agent
          inbox,
          jsState,
          getLogs: () => lastStepLogs.join('\n'),
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

        // Save wait state
        if (result.kind === "wait" && result.patch) {
          // Goal is no longer editable
          // if (result.patch.goal !== undefined)
          //   state.goal = result.patch.goal;
          if (result.patch.plan !== undefined) state.plan = result.patch.plan;
          if (result.patch.notes !== undefined)
            state.notes = result.patch.notes;
          if (result.patch.asks !== undefined) state.asks = result.patch.asks;
          await this.api.taskStore.saveState(state);
        }

        // Mark inbox items as finished
        await this.handleInboxItems(task, inboxItems);

        // Reply for replier & task run info
        const taskReply = this.formatTaskReply(result);

        // Prepare run end
        await this.finishTaskRun(
          taskRunId,
          runStartTime,
          result,
          state,
          taskReply,
          agent,
          logs
        );

        // Recurring task cancelled?
        const cancelled = !!sandbox.context?.data?.cancelled;

        // Update task in wait status,
        // Router and Replier always end up in 'wait/asks' status
        // to reuse the same task for every run
        const isWait =
          !cancelled &&
          (result.kind === "wait" ||
            task.cron ||
            taskType === "replier" ||
            taskType === "router");

        if (isWait) {
          // Need new timestamp?
          const isPersistentTask =
            taskType === "router" || taskType === "replier";
          const timestamp =
            result.kind === "wait" && result.resumeAt
              ? Math.floor(new Date(result.resumeAt).getTime() / 1000)
              : isPersistentTask
              ? Math.floor(Date.now() / 1000) // set to current time
              : task.cron
              ? Math.floor(new Cron(task.cron).nextRun()!.getTime() / 1000)
              : task.timestamp;
          const status =
            result.kind === "wait" && result.resumeAt
              ? "wait"
              : task.cron
              ? "" // Necessary to get on TODO list next time
              : "asks";

          this.debug(
            `Updating ${task.type || ""} task ${task.id} cron '${
              task.cron
            }' timestamp ${timestamp} (resumeAt '${
              result.kind === "wait" ? result.resumeAt : ""
            }') asks '${result.patch?.asks || ""}' status '${status}'`
          );

          await this.api.taskStore.updateTask({
            ...task,
            timestamp,
            reply: result.reply || "",
            state: status,
            error: "",
            thread_id: task.thread_id,
          });

          this.debug(`Task '${status}':`, {
            id: task.id,
            timestamp,
            threadId: task.thread_id,
            status,
            asks: state?.asks,
            cron: task.cron,
          });
        } else {
          // Single-shot task finished
          await this.finishTask(task, taskReply, cancelled ? "Cancelled" : "");

          this.debug(`Task done:`, {
            reply: taskReply,
            threadId: task.thread_id,
            cancelled,
          });
        }

        // Send reply/asks to recipient (replier inbox or user)
        await this.handleReply(taskType, task, state, result, taskRunId);

        // Reset retry state on successful completion
        this.taskRetryState.delete(task.id);
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
          // Schedule retry for this task
          await this.retry(task, errorMessage, task.thread_id);
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

          // Reset retry state on failed task
          this.taskRetryState.delete(task.id);
        }

        // Provider low balance
        if (error === ERROR_PAYMENT_REQUIRED) {
          // Pause ALL task processing for 10 minutes
          this.globalPauseUntil = Date.now() + 10 * 60 * 1000; // 10 minutes from now
          this.debug(
            `PAYMENT_REQUIRED: Pausing all task processing until ${new Date(
              this.globalPauseUntil
            ).toISOString()}`
          );
        }
      }
    } catch (error) {
      this.debug("Task handling error:", error);
      throw error;
    } finally {
      if (statusUpdaterInterval) clearInterval(statusUpdaterInterval);
      this.debug(`Clear agent status`);
      await this.api.setAgentStatus("");
    }
  }

  private async processTaskScript(
    task: Task,
    taskType: TaskType,
    script: Script
  ) {
    const scriptRunId = generateId();
    this.debug(
      "Running script run",
      scriptRunId,
      "script",
      script.id,
      "task",
      task.id
    );

    await this.api.scriptStore.startScriptRun(
      scriptRunId,
      script.id,
      new Date().toISOString()
    );

    // Initialize logs array for this script run
    const logs: string[] = [];

    try {
      // Js sandbox with proper 'context' object
      const sandbox = await this.createSandbox(
        taskType,
        task,
        undefined,
        scriptRunId,
        logs
      );

      // Inits js API in the sandbox
      await this.createEnv(taskType, task, sandbox);

      // Run the code
      const result = await sandbox.eval(script.code, {
        timeoutMs: 300000,
      });

      if (result.ok) {
        this.debug("Script result", result.result);
      } else {
        this.debug("Script error", result.error);
        throw result.error;
      }

      // Task finished ok
      await this.api.scriptStore.finishScriptRun(
        scriptRunId,
        new Date().toISOString(),
        JSON.stringify(result.result) || "",
        "",
        logs.join('\n')
      );

      if (task.cron) {
        const timestamp = Math.floor(
          new Cron(task.cron).nextRun()!.getTime() / 1000
        );

        this.debug(
          `Updating ${task.type || ""} task ${task.id} cron '${
            task.cron
          }' timestamp ${timestamp}`
        );

        await this.api.taskStore.updateTask({
          ...task,
          timestamp,
          reply: JSON.stringify(result.result) || "",
          state: "wait",
          error: "",
          thread_id: task.thread_id,
        });
      } else {
        // FIXME for event handlers, what do we do?
      }
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      try {
        await this.api.scriptStore.finishScriptRun(
          scriptRunId,
          new Date().toISOString(),
          "",
          errorMessage,
          logs.join('\n')
        );
      } catch (e) {
        this.debug("finishScriptRun error", e);
      }

      // FIXME handle BAD_REQUEST and PAYMENT_REQUIRED from LLM tool calls

      this.debug("Send script error to planner", task.id);

      // Send error to parent task
      await this.api.inboxStore.saveInbox({
        id: scriptRunId,
        source: "script",
        source_id: scriptRunId,
        target: "planner",
        target_id: task.id,
        timestamp: new Date().toISOString(),
        content: JSON.stringify({
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Last script launch resulted in error:\n" + errorMessage,
            },
          ],
          metadata: {
            createdAt: new Date().toISOString(),
          },
          reasoning: '',
          sourceTaskId: task.id,
          sourceTaskType: taskType,
        }),
        handler_thread_id: "",
        handler_timestamp: "",
      });

      // Schedule a retry
      await this.retry(task, errorMessage, task.thread_id);
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

  private async loadJsState(taskId: string): Promise<any | undefined> {
    if (!this.userPath) return undefined;

    try {
      const stateFile = fileUtils.join(
        this.userPath,
        "state",
        `${taskId}.json`
      );
      if (!fileUtils.existsSync(stateFile)) {
        this.debug(`No JS state file found for task ${taskId}`);
        return undefined;
      }

      const stateContent = fileUtils.readFileSync(stateFile, "utf8") as string;
      const state = JSON.parse(stateContent);
      this.debug(`Loaded JS state for task ${taskId} from ${stateFile}`);
      return state;
    } catch (error) {
      this.debug(`Failed to load JS state for task ${taskId}:`, error);
      return undefined;
    }
  }

  private async handleReply(
    taskType: TaskType,
    task: Task,
    state: TaskState,
    result: StepOutput,
    taskRunId: string
  ) {
    if (result.kind === "code") throw new Error("Can't handle 'code' reply");
    // Send reply after all done
    if (result.reply) {
      // DEBUG: allow worker to reply directly to user for testing
      // if (
      //   taskType === "worker" ||
      //   taskType === "replier" ||
      //   taskType === "router"
      // ) {
      await this.sendToUser(result.reply);
      // } else {
      //   await this.sendToReplier({
      //     taskType,
      //     taskRunId,
      //     taskId: task.id,
      //     content: result.reply,
      //     reasoning: result.reasoning || "",
      //   });
      // }
    }

    // We ran an iteraction and still have asks in state?
    // Send to replier
    if (result.kind === "wait" && taskType === "worker") {
      if (state.asks) {
        await this.sendToUser(state.asks);
        // await this.sendToReplier({
        //   taskType,
        //   taskRunId,
        //   taskId: task.id,
        //   content: state.asks,
        //   reasoning: result.reasoning || "",
        // });
      }
    }
  }

  private async createTaskRun(
    agentTask: AgentTask,
    threadId: string,
    modelName: string,
    reason: StepReason,
    inbox: string[]
  ) {
    const taskRunId = generateId();
    const runStartTime = new Date();
    await this.api.taskStore.createTaskRun({
      id: taskRunId,
      task_id: agentTask.id,
      thread_id: threadId,
      start_timestamp: runStartTime.toISOString(),
      type: agentTask.type,
      model: modelName,
      reason,
      inbox: JSON.stringify(inbox),
      input_asks: agentTask.state?.asks || "",
      input_goal: agentTask.state?.goal || "",
      input_plan: agentTask.state?.plan || "",
      input_notes: agentTask.state?.notes || "",
    });

    await this.api.chatStore.saveChatEvent(taskRunId, "main", "task_run", {
      task_id: agentTask.id,
      task_run_id: taskRunId,
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

  private async finishTaskRun(
    taskRunId: string,
    runStartTime: Date,
    result: StepOutput,
    state: TaskState,
    taskReply: string,
    agent: ReplAgent,
    logs: string[]
  ) {
    const runEndTime = new Date();
    await this.api.taskStore.finishTaskRun({
      id: taskRunId,
      run_sec: Math.floor(
        (runEndTime.getTime() - runStartTime.getTime()) / 1000
      ),
      end_timestamp: runEndTime.toISOString(),
      steps: result.steps,
      state: result.kind,
      output_asks: state.asks,
      output_goal: state.goal,
      output_plan: state.plan,
      output_notes: state.notes,
      reply: taskReply,
      input_tokens: agent.usage.inputTokens || 0,
      cached_tokens: agent.usage.cachedInputTokens || 0,
      output_tokens:
        (agent.usage.outputTokens || 0) + (agent.usage.reasoningTokens || 0),
      cost: Math.ceil((agent.openRouterUsage.cost || 0) * 1000000),
      logs: logs.join('\n'),
    });

    // Write usage stats
    await this.api.chatStore.saveChatEvent(taskRunId, "main", "task_run_end", {
      task_id: state.id,
      task_run_id: taskRunId,
      usage: agent.openRouterUsage,
    });
  }

  private async createEnv(taskType: TaskType, task: Task, sandbox: Sandbox) {
    const env = new AgentEnv(
      this.api,
      taskType,
      task,
      () => sandbox.context!,
      this.userPath,
      this.gmailOAuth2Client
    );
    sandbox.setGlobal(await env.createGlobal());

    return env;
  }

  private async createSandbox(
    taskType: TaskType,
    task: Task,
    taskRunId?: string,
    scriptRunId?: string,
    logs?: string[]
  ) {
    // Sandbox
    const sandbox = await initSandbox();

    // Init context
    sandbox.context = {
      step: 0,
      taskId: task.id,
      taskRunId,
      scriptRunId,
      type: taskType,
      taskThreadId: task.thread_id,
      createEvent: async (type: string, content: any, tx?: DBInterface) => {
        // set task fields
        content.task_id = task.id;
        content.task_run_id = taskRunId;
        content.script_run_id = scriptRunId;
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

  private async getTaskState(task: Task): Promise<TaskState> {
    return (
      (await this.api.taskStore.getState(task.id)) || {
        id: task.id,
        goal: "",
        plan: "",
        asks: "",
        notes: "",
      }
    );
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

    // @ts-ignore
    const inbox: string[] = inboxItems
      .map((i) => {
        try {
          const message = JSON.parse(i.content);
          return JSON.stringify({
            ...message,
            id: i.id,
          });
        } catch {}
      })
      .filter(Boolean);

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

  private async startStatusUpdater(type: TaskType | "script") {
    // Set agent status in db
    let status = "";
    switch (type) {
      case "replier":
        status = "Typing...";
        break;
      case "router":
        status = "Thinking...";
        break;
      case "planner":
        status = "Planning...";
        break;
      case "script":
        status = "Executing...";
        break;
      default:
        status = "Working...";
        break;
    }
    const update = async () => {
      this.debug(`Update agent status: '${status}'`);
      await this.api.setAgentStatus(status);
    };
    const interval = setInterval(
      update,
      Math.max(10000, MAX_STATUS_TTL - 5000)
    );
    await update();
    return interval;
  }

  private async ensureThread(threadId: string, taskType: TaskType) {
    let title = "";
    switch (taskType) {
      case "router":
        title = "Router";
        break;
      case "replier":
        title = "Replier";
        break;
      case "worker":
        title = "Worker";
        break;
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

  private async retry(task: Task, error: string, thread_id: string) {
    // Get current retry state or create new one
    const currentRetryState = this.taskRetryState.get(task.id) || {
      retryCount: 0,
      nextStart: 0,
    };

    // Increment retry count
    currentRetryState.retryCount += 1;

    // Calculate exponential backoff: 10s * 2^(retryCount-1), max 10 minutes (600s)
    const baseDelayMs = 10 * 1000; // 10 seconds in milliseconds
    const exponentialDelayMs =
      baseDelayMs * Math.pow(2, currentRetryState.retryCount - 1);
    const maxDelayMs = 10 * 60 * 1000; // 10 minutes in milliseconds
    const actualDelayMs = Math.min(exponentialDelayMs, maxDelayMs);

    // Set next start time in retry state map
    currentRetryState.nextStart = Date.now() + actualDelayMs;
    this.taskRetryState.set(task.id, currentRetryState);

    // Write default retry delays to database as originally designed
    const retryDelaySeconds =
      task.type === "message" ? 10 : task.type ? 60 : 600;
    const retryTimestamp = Math.floor(Date.now() / 1000) + retryDelaySeconds;

    // FIXME reusing thread_id doesn't help much since we're only writing down agent replies
    // in onFinish which means only if everything goes well, so on failure the thread will still be empty

    // Update the current task instead of finishing and adding a new one
    try {
      await this.api.taskStore.updateTask({
        ...task,
        timestamp: retryTimestamp,
        reply: "",
        state: "", // Keep state empty so it can be retried
        error, // Set the error message
        thread_id, // Update thread_id if it was generated
      });
    } catch (e) {
      this.debug("updateTask error", e);
    }

    this.debug(
      `Updated ${task.type || ""} task ${
        task.id
      } for retry: DB timestamp ${retryTimestamp} (${retryDelaySeconds}s), actual retry in ${actualDelayMs}ms (${Math.round(
        actualDelayMs / 1000
      )}s), attempt ${currentRetryState.retryCount}, error: ${error}`
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

  private async ensureTask(target: InboxItemTarget) {
    const tasks = await this.api.taskStore.listTasks();
    if (tasks.find((t) => t.type === target)) return;

    this.debug("Creating task: ", target);
    const taskId = bytesToHex(randomBytes(16));
    const timestamp = Math.floor(Date.now() / 1000) - 1; // -1 - force to run immediately
    await this.api.taskStore.addTask(
      taskId,
      timestamp,
      "", // task content
      target, // type
      "", // Empty thread id, task has it's own thread
      target, // title
      "" // cron
    );
  }

  private async sendToReplier(opts: {
    taskType: "worker" | "router";
    taskId: string;
    taskRunId: string;
    content: string;
    reasoning: string;
  }) {
    this.debug("Send reply to replier", opts);
    // Send router's reply to replier
    await this.api.inboxStore.saveInbox({
      id: opts.taskRunId,
      source: opts.taskType,
      source_id: opts.taskRunId,
      target: "replier",
      target_id: "",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: opts.content,
          },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
        },
        reasoning: opts.reasoning,
        sourceTaskId: opts.taskId,
        sourceTaskType: opts.taskType,
      }),
      handler_thread_id: "",
      handler_timestamp: "",
    });
  }

  private async sendToUser(reply: string) {
    this.debug("Save user reply", reply);

    const message = {
      id: generateId(),
      role: "assistant" as const,
      metadata: {
        createdAt: new Date().toISOString(),
        threadId: "main",
      },
      parts: [
        {
          type: "text" as const,
          text: reply,
        },
      ],
    };

    // Save to both tables in one transaction
    await this.api.db.db.tx(async (tx) => {
      await this.api.memoryStore.saveMessages([message], tx);
      await this.api.chatStore.saveChatMessages("main", [message], tx);
    });
  }
}
