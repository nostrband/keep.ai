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
  InboxItem,
  InboxItemTarget,
  KeepDbApi,
  MAX_STATUS_TTL,
  Task,
  TaskState,
} from "@app/db";
import {
  AgentTask,
  StepOutput,
  StepReason,
  TaskType,
} from "./repl-agent-types";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { ReplEnv } from "./repl-env";
import { isValidEnv } from "./env";
import { Cron } from "croner";

export interface TaskWorkerConfig {
  api: KeepDbApi;
  stepLimit?: number; // default 50
}

export class TaskWorker {
  private api: KeepDbApi;
  private stepLimit: number;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  private debug = debug("agent:TaskWorker");

  constructor(config: TaskWorkerConfig) {
    this.api = config.api;
    this.stepLimit = config.stepLimit || 50;
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

      // Get tasks with expired timers and with non-empty inboxes
      const todoTasks = await this.api.taskStore.getTodoTasks();
      if (inboxItems.find((i) => i.target === "router"))
        todoTasks.push(
          ...(await this.api.taskStore.listTasks(false, "router"))
        );
      if (inboxItems.find((i) => i.target === "replier"))
        todoTasks.push(
          ...(await this.api.taskStore.listTasks(false, "replier"))
        );
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

      // Uniq tasks array, sorted by timestamp asc
      const tasks = [...taskMap.values()].sort(
        (a, b) => a.timestamp - b.timestamp
      );
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
      if (task.state === "finished" || task.state === "error") {
        this.debug("Task already processed with state:", task.state);
        return;
      }

      // Type check to cast to TaskType safely
      if (
        task.type !== "worker" &&
        task.type !== "router" &&
        task.type !== "replier"
      ) {
        this.debug("Unsupported task type", task.type);
        return this.finishTask(task, "Wrong type", "Unsupported task type");
      }
      const taskType: TaskType = task.type;

      const { inboxItems, inbox } = await this.getInboxItems(taskType, task.id);
      if (taskType !== "worker" && !inbox.length) {
        this.debug("Empty task inbox", task.type, task.id);
        return this.finishTask(task, "Empty inbox", "Empty inbox");
      }

      // =============================
      // Valid task, can start working

      // Set agent status in db
      statusUpdaterInterval = await this.startStatusUpdater(taskType);

      // New thread for each attempt
      task.thread_id = generateId();
      // Placeholder, FIXME add title?
      await this.ensureThread(task.thread_id, taskType);

      // Get task state
      const state = await this.getTaskState(task);

      // Sandbox
      const sandbox = await this.createSandbox(taskType, task);

      // Env
      const env = await this.createEnv(taskType, task, sandbox);

      // Agent task
      const agentTask: AgentTask = {
        id: task.id,
        type: taskType,
        state: {
          ...state,
        },
      };

      // Run reason
      let reason: "start" | "input" | "timer" = "start";
      if (task.state !== "") reason = inbox.length > 0 ? "input" : "timer";

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

      // Init agent
      const model = getOpenRouter()(modelName);
      const agent = new ReplAgent(model, env, sandbox, agentTask);

      try {
        // Helper
        const savedIds = new Set<string>();
        const saveNewMessages = async () => {
          const newMessages = agent.history.filter((m) => !savedIds.has(m.id));
          this.debug("Save new messages", newMessages);
          await this.saveHistory(newMessages, task.thread_id);
          newMessages.forEach((m) => savedIds.add(m.id));
        };

        // Use task.task as input message to the agent
        const result = await agent.loop(reason, {
          // Pass the input text to agent
          inbox,
          onStep: async (step) => {
            await saveNewMessages();
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
        const now = new Date().toISOString();
        for (const item of inboxItems)
          await this.api.inboxStore.handleInboxItem(
            item.id,
            now,
            task.thread_id
          );

        // Reply for replier & task run info
        const taskReply = this.formatTaskReply(result);

        // Prepare run end
        await this.finishTaskRun(
          taskRunId,
          runStartTime,
          result,
          state,
          taskReply,
          agent
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
            cancelled
          });
        }

        // Send reply/asks to recipient (replier inbox or user)
        await this.handleReply(taskType, task, state, result, taskRunId);
      } catch (error) {
        this.debug("Task processing error:", error);

        // On exception, update the task with error and retry timestamp instead of finish+add
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        // Finish run with error
        await this.api.taskStore.errorTaskRun(
          taskRunId,
          new Date().toISOString(),
          errorMessage
        );

        // Schedule retry for this task
        await this.retry(task, errorMessage, task.thread_id);

        throw error; // Re-throw to be caught by caller
      }
    } catch (error) {
      this.debug("Task processing error:", error);
      throw error;
    } finally {
      if (statusUpdaterInterval) clearInterval(statusUpdaterInterval);
      this.debug(`Clear agent status`);
      await this.api.setAgentStatus("");
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
      if (taskType === "replier" || taskType === "router") {
        await this.sendToUser(result.reply);
      } else {
        await this.sendToReplier({
          taskType,
          taskRunId,
          taskId: task.id,
          content: result.reply,
          reasoning: result.reasoning || "",
        });
      }
    }

    // We ran an iteraction and still have asks in state?
    // Send to replier
    if (result.kind === "wait" && taskType === "worker") {
      if (state.asks) {
        await this.sendToReplier({
          taskType,
          taskRunId,
          taskId: task.id,
          content: state.asks,
          reasoning: result.reasoning || "",
        });
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
    return {
      taskRunId,
      runStartTime,
    };
  }

  private async finishTaskRun(
    taskRunId: string,
    runStartTime: Date,
    result: StepOutput,
    state: TaskState,
    taskReply: string,
    agent: ReplAgent
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
    });
  }

  private async createEnv(taskType: TaskType, task: Task, sandbox: Sandbox) {
    const env = new ReplEnv(
      this.api,
      taskType,
      task.cron,
      () => sandbox.context!
    );
    sandbox.setGlobal(await env.createGlobal());

    return env;
  }

  private async createSandbox(taskType: TaskType, task: Task) {
    // Sandbox
    const sandbox = await initSandbox();

    // Init context
    sandbox.context = {
      step: 0,
      taskId: task.id,
      type: taskType,
      taskThreadId: task.thread_id,
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

  private async startStatusUpdater(type: TaskType) {
    // Set agent status in db
    let status = "";
    switch (type) {
      case "replier":
        status = "Typing...";
        break;
      case "router":
        status = "Thinking...";
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
    // Re-schedule the same task with different retry intervals based on type,
    // message: 10 sec,
    // task: 60 sec,
    // planner: 600 sec
    const retryDelaySeconds =
      task.type === "message" ? 10 : task.type ? 60 : 600;
    const retryTimestamp = Math.floor(Date.now() / 1000) + retryDelaySeconds;

    // FIXME reusing thread_id doesn't help much since we're only writing down agent replies
    // in onFinish which means only if everything goes well, so on failure the thread will still be empty

    // Update the current task instead of finishing and adding a new one
    await this.api.taskStore.updateTask({
      ...task,
      timestamp: retryTimestamp,
      reply: "",
      state: "", // Keep state empty so it can be retried
      error, // Set the error message
      thread_id, // Update thread_id if it was generated
    });

    this.debug(
      `Updated ${task.type || ""} task ${
        task.id
      } for retry at timestamp ${retryTimestamp} (retry in ${retryDelaySeconds} seconds) with error: ${error}`
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
        content: opts.content,
        timestamp: new Date().toISOString(),
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
    await this.api.memoryStore.saveMessages([
      {
        id: generateId(),
        role: "assistant",
        metadata: {
          createdAt: new Date().toISOString(),
          // FIXME not good!
          threadId: "main",
        },
        parts: [
          {
            type: "text",
            text: reply,
          },
        ],
      },
    ]);
  }
}
