import { generateId } from "ai";
import {
  getMessageText,
  getModelName,
  getOpenRouter,
  ReplAgent,
} from "./index";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";
import { InboxItemTarget, KeepDbApi, MAX_STATUS_TTL, Task } from "@app/db";
import { AGENT_STATUS } from "./instructions";
import { createAgentSandbox } from "./agent-sandbox";
import { StepOutput, TaskType } from "./task-agent";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";

export interface ReplWorkerConfig {
  api: KeepDbApi;
  stepLimit?: number; // default 50
}

export class ReplWorker {
  private api: KeepDbApi;
  private stepLimit: number;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;

  private debug = debug("ReplWorker");

  constructor(config: ReplWorkerConfig) {
    this.api = config.api;
    this.stepLimit = config.stepLimit || 50;
  }

  async close(): Promise<void> {
    if (!this.isRunning) return;
    this.isShuttingDown = true;
  }

  public async checkWork(): Promise<void> {
    if (this.isShuttingDown) return;
    if (this.isRunning) return;
    this.isRunning = true;

    // Auto-create router and replier tasks
    await this.checkInbox();

    // Any tasks?
    const more = await this.checkTasks();

    // Done
    this.isRunning = false;

    // Retry immediately in case more jobs might be incoming
    if (more) this.checkWork();
  }

  private async checkInbox() {
    const ensureTask = async (type: InboxItemTarget) => {
      const routerItems = await this.api.inboxStore.listInboxItems({
        target: type,
        handled: false,
      });
      if (routerItems.length > 0) {
        await this.ensureTask("router");
      }
    }
    try {
      await ensureTask("router");
      await ensureTask("replier");
    } catch (err) {
      this.debug("checkInbox error:", err);
    }
  }

  private async checkTasks(): Promise<boolean> {
    let task: Task | null = null;
    try {
      this.debug(`checking @ ${new Date().toISOString()}`);

      // Get the next task for the user (only returns tasks ready to trigger)
      task = await this.api.taskStore.getNextTask();

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

    return task !== null;
  }

  private async processTask(task: Task): Promise<void> {
    this.debug("Process task", task);

    let statusUpdaterInterval: ReturnType<typeof setInterval> | undefined;
    try {
      if (task.state !== "") {
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
      const inboxItems = await this.api.inboxStore.listInboxItems({
        target: taskType,
        handled: false,
      });
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

      // New thread for each attempt
      const threadId = generateId();

      // Set agent status in db
      statusUpdaterInterval = await this.startStatusUpdater(taskType);

      // Create agent
      const sandbox = await createAgentSandbox(this.api);
      const model = getOpenRouter()(getModelName());
      const agent = new ReplAgent(model, sandbox, {
        type: taskType,
      });

      try {
        // Use task.task as input message to the agent
        const result = await agent.loop("start", {
          // Pass the input text to agent
          inbox,
          onStep: async (step) => {
            return { proceed: step < this.stepLimit };
          },
        });
        this.debug(`Loop steps ${result?.steps} result ${result}`);
        if (!result || result.kind !== "done") {
          throw new Error("Bad result");
        }

        // Save task messages
        this.debug("Save task messages", agent.agent.history);
        await this.ensureThread(threadId, taskType);
        await this.saveHistory(agent.agent.history, threadId);

        if (taskType === "router" && result.reply) {
          // Send reply to user's thread
          // FIXME Replier agent will be doing it later
          this.debug("Save user reply", result.reply);
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
                  text: result.reply,
                },
              ],
            },
          ]);
        }

        // Task reply for audit traces
        const taskReply = this.formatTaskReply(result);

        // Single-shot task finished
        await this.api.taskStore.finishTask(task.id, threadId, taskReply, "");

        // Mark items as finished
        const now = new Date().toISOString();
        for (const item of inboxItems)
          await this.api.inboxStore.handleInboxItem(item.id, now, threadId);

        this.debug(`task processed successfully:`, {
          success: true,
          reply: taskReply,
          threadId,
        });
      } catch (error) {
        this.debug("Task processing error:", error);

        // On exception, update the task with error and retry timestamp instead of finish+add
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

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

  private async getSourceMessage(messageId: string) {
    const sourceMessages = await this.api.memoryStore.getMessages({
      messageId,
    });
    const sourceMessage = sourceMessages.find((m) => m.id === messageId);

    if (!sourceMessage || sourceMessage.role !== "user") {
      this.debug("Task message not found", messageId);
      throw new Error("Message not found");
    }
    return sourceMessage;
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
    if (result.kind !== "done") throw new Error("Wrong task kind for reply");
    return `===REASONING===
${result.reasoning || ""}
===REPLY===
${result.reply || ""}
`;
  }

  private async ensureTask(target: InboxItemTarget) {
    const tasks = await this.api.taskStore.listTasks();
    if (tasks.find((t) => t.type === target)) return;

    const taskId = bytesToHex(randomBytes(16));
    const timestamp = Math.floor(Date.now() / 1000) - 1; // -1 - force to run immediately
    await this.api.taskStore.addTask(
      taskId,
      timestamp,
      "", // task content
      target, // type
      "", // Empty thread id, task has it's own thread
      "Router", // title
      "" // cron
    );
  }
}
