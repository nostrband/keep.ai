import { generateId } from "ai";
import { getModelName, getOpenRouter, initSandbox, ReplAgent } from "./index";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";
import {
  InboxItem,
  InboxItemTarget,
  KeepDbApi,
  MAX_STATUS_TTL,
  Task,
} from "@app/db";
import { AGENT_STATUS } from "./instructions";
import { AgentTask, StepOutput, TaskType } from "./repl-agent-types";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { ReplEnv } from "./repl-env";

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

  private async processTask(task: Task): Promise<void> {
    this.debug("Process task", task);

    let statusUpdaterInterval: ReturnType<typeof setInterval> | undefined;
    try {
      if (task.state === "finished" || task.state === "error") {
        this.debug("Task already processed with state:", task.state);
        return;
      }

      // Type check
      if (
        task.type !== "worker" &&
        task.type !== "router" &&
        task.type !== "replier"
      ) {
        this.debug("Unsupported task type", task.type);
        await this.api.taskStore.finishTask(
          task.id,
          task.thread_id,
          "Wrong type",
          "Unsupported task type"
        );
        return;
      }
      const taskType: TaskType = task.type;

      // Fill inbox
      const inboxItems = (
        await this.api.inboxStore.listInboxItems({
          target: taskType,
          handled: false,
        })
      ).filter((i) => !i.target_id || i.target_id === task.id);

      const inbox = inboxItems.map((i) => i.content);
      if (taskType !== "worker" && !inbox.length) {
        await this.api.taskStore.finishTask(
          task.id,
          task.thread_id,
          "Empty inbox",
          "Empty inbox"
        );
        return;
      }

      // Get task state
      let state = await this.api.taskStore.getState(task.id);

      // New thread for each attempt
      const threadId = generateId();

      // Set agent status in db
      statusUpdaterInterval = await this.startStatusUpdater(taskType);

      // Sandbox
      const sandbox = await initSandbox();

      // Init context
      sandbox.context = {
        step: 0,
        taskId: task.id,
        type: taskType,
        taskThreadId: threadId,
      };

      // Env
      const env = new ReplEnv(this.api, taskType, () => sandbox.context!);
      sandbox.setGlobal(await env.createGlobal());

      // Agent task
      const agentTask: AgentTask = {
        id: task.id,
        type: taskType,
        state: {},
      };
      if (state?.goal) agentTask.state!.goal = state.goal;
      if (state?.notes) agentTask.state!.notes = state.notes;
      if (state?.plan) agentTask.state!.plan = state.plan;
      if (state?.asks) agentTask.state!.asks = state.asks;

      // Run reason
      let reason: "start" | "input" | "timer" = "start";
      if (task.state !== "") reason = inbox.length > 0 ? "input" : "timer";

      // Model for agent
      const modelName = getModelName();

      // Start the run
      const taskRunId = generateId();
      const runStartTime = new Date();
      await this.api.taskStore.createTaskRun({
        id: taskRunId,
        task_id: task.id,
        thread_id: threadId,
        start_timestamp: runStartTime.toISOString(),
        type: taskType,
        model: modelName,
        reason,
        inbox: JSON.stringify(inbox),
        input_asks: agentTask.state?.asks || "",
        input_goal: agentTask.state?.goal || "",
        input_plan: agentTask.state?.plan || "",
        input_notes: agentTask.state?.notes || "",
      });

      // Init agent
      const model = getOpenRouter()(modelName);
      const agent = new ReplAgent(model, env, sandbox, agentTask);

      try {
        // Use task.task as input message to the agent
        const result = await agent.loop(reason, {
          // Pass the input text to agent
          inbox,
          onStep: async (step) => {
            return { proceed: step < this.stepLimit };
          },
        });
        this.debug(
          `Loop steps ${result?.steps} result ${JSON.stringify(result)}`
        );

        if (!result) throw new Error("Bad result");
        if (result.kind === "code") throw new Error("Step limit exceeded");

        // Save task messages
        this.debug("Save task messages", agent.history);
        await this.ensureThread(threadId, taskType);
        await this.saveHistory(agent.history, threadId);

        // Save wait state
        if (result.kind === "wait" && result.patch) {
          state = {
            id: task.id,
            goal: result.patch.goal || state?.goal || "",
            notes: result.patch.notes || state?.notes || "",
            plan: result.patch.plan || state?.plan || "",
            asks: result.patch.asks || state?.asks || "",
          };
          await this.api.taskStore.saveState(state);
        }

        // Mark inbox items as finished
        const now = new Date().toISOString();
        for (const item of inboxItems)
          await this.api.inboxStore.handleInboxItem(item.id, now, threadId);

        // Prepare run end
        const runEndTime = new Date();
        const taskReply = this.formatTaskReply(result);
        await this.api.taskStore.finishTaskRun({
          id: taskRunId,
          run_sec: Math.floor(
            (runEndTime.getTime() - runStartTime.getTime()) / 1000
          ),
          end_timestamp: runEndTime.toISOString(),
          steps: result.steps,
          state: result.kind,
          output_asks: state?.asks || "",
          output_goal: state?.goal || "",
          output_plan: state?.plan || "",
          output_notes: state?.notes || "",
          reply: taskReply,
          // FIXME set
          input_tokens: 0,
          cached_tokens: 0,
          output_tokens: 0,
        });

        // Update task in wait status,
        // Router and Replier always end up in 'wait/asks' status
        // to reuse the same task for every run
        const isWait =
          result.kind === "wait" ||
          taskType === "replier" ||
          taskType === "router";

        if (isWait) {
          // Need new timestamp?
          const timestamp =
            result.kind === "wait" && result.resumeAt
              ? Math.floor(new Date(result.resumeAt).getTime() / 1000)
              : task.timestamp;
          const status =
            result.kind === "wait" && result.resumeAt ? "wait" : "asks";

          this.debug(
            `Updating ${task.type || ""} task ${
              task.id
            } timestamp ${timestamp} (resumeAt '${
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

          this.debug(`Task wait:`, {
            id: task.id,
            timestamp,
            threadId,
            status,
            asks: state?.asks,
          });
        } else {
          // Single-shot task finished
          await this.api.taskStore.finishTask(task.id, threadId, taskReply, "");

          this.debug(`Task done:`, {
            reply: taskReply,
            threadId,
          });
        }

        // Send reply after all done
        if (result.reply) {
          if (taskType === "replier") {
            await this.sendToUser(result.reply);
          } else {
            await this.sendToReplier(result.reply, task.id, taskRunId);
          }
        }
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
        await this.retry(task, errorMessage, threadId);

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

  private async startStatusUpdater(type: TaskType) {
    // Set agent status in db
    let status: AGENT_STATUS = "task";
    switch (type) {
      case "replier":
      case "router":
        status = "user";
        break;
      default:
        status = "task";
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

  private async sendToReplier(
    reply: string,
    taskId: string,
    taskRunId: string
  ) {
    this.debug("Send reply to replier", reply);
    // Send router's reply to replier
    await this.api.inboxStore.saveInbox({
      id: taskRunId,
      source: "router",
      source_id: taskRunId,
      target: "replier",
      target_id: "",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        role: "assistant",
        content: reply,
        sourceTaskId: taskId,
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
