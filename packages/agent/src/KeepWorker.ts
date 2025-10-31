import { convertToModelMessages, generateId } from "ai";
import { makeAgent, AGENT_MODE, createPlannerTaskPrompt } from "./index";
import { makeToolset } from "./index";
import { AssistantUIMessage, MessageMetadata, ROUTINE_TASKS } from "@app/proto";
import { Cron } from "croner";
import debug from "debug";
import { KeepDbApi, MAX_STATUS_TTL, Task } from "@app/db";
import { AGENT_STATUS } from "./instructions";

const debugKeepWorker = debug("agent:KeepWorker");

export interface KeepWorkerConfig {
  api: KeepDbApi;
  checkInterval?: number; // milliseconds, default 5000
  stepLimit?: number; // default 50
  routineTasks?: Record<string, string>; // taskType -> cronSchedule
}

export class KeepWorker {
  private api: KeepDbApi;
  private checkInterval: number;
  private stepLimit: number;
  private routineTasks: Record<string, string>;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: KeepWorkerConfig) {
    this.api = config.api;
    this.checkInterval = config.checkInterval || 1000;
    this.stepLimit = config.stepLimit || 50;
    this.routineTasks = config.routineTasks || ROUTINE_TASKS;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      debugKeepWorker("Already running");
      return;
    }

    this.isRunning = true;
    this.isShuttingDown = false;

    debugKeepWorker("Starting worker...");

    try {
      // Initialize routine tasks before starting polling
      await this.initializeRoutineTasks();

      // Start the task checking loop
      this.scheduleNextCheck();

      debugKeepWorker("Worker started successfully");
    } catch (error) {
      debugKeepWorker("Failed to start worker:", error);
      this.isRunning = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.isRunning) {
      debugKeepWorker("Already stopped");
      return;
    }

    debugKeepWorker("Stopping worker...");
    this.isShuttingDown = true;
    this.isRunning = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    debugKeepWorker("Worker stopped");
  }

  private async initializeRoutineTasks(): Promise<void> {
    try {
      debugKeepWorker("Checking routine tasks...");

      for (const [taskType, cronSchedule] of Object.entries(
        this.routineTasks
      )) {
        debugKeepWorker(
          `Checking for ${taskType} task with cron schedule: ${cronSchedule}`
        );

        try {
          // Check if a task with this type and non-empty cron already exists
          const existingTask = await this.api.taskStore.hasCronTaskOfType(
            taskType
          );

          if (!existingTask) {
            debugKeepWorker(`No ${taskType} cron task found, creating one`);

            // First run immediately
            const timestamp = Math.floor(Date.now() / 1000);

            // Create task content based on type
            let taskContent = "";
            let title = "";
            if (taskType === "planner") {
              title = "Daily Planning";
            }

            await this.api.taskStore.addTask(
              generateId(),
              timestamp,
              taskContent,
              taskType,
              "", // thread_id
              title,
              cronSchedule
            );

            debugKeepWorker(
              `Created ${taskType} cron task for next run at: ${new Date(
                timestamp * 1000
              ).toISOString()}`
            );
          } else {
            debugKeepWorker(`${taskType} cron task already exists`);
          }
        } catch (error) {
          debugKeepWorker(`Error processing ${taskType} routine task:`, error);
        }
      }
    } catch (error) {
      debugKeepWorker("Error initializing routine tasks:", error);
    }
  }

  private scheduleNextCheck(): void {
    if (this.isShuttingDown) return;

    this.timeoutId = setTimeout(() => {
      this.checkTasks()
        .catch((error) => {
          debugKeepWorker("Error in checkTasks:", error);
        })
        .finally(() => {
          // Schedule next check regardless of success/failure
          this.scheduleNextCheck();
        });
    }, this.checkInterval);
  }

  private async checkTasks(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      debugKeepWorker(`checking @ ${new Date().toISOString()}`);

      // Get the next task for the user (only returns tasks ready to trigger)
      const task = await this.api.taskStore.getNextTask();

      if (task) {
        debugKeepWorker(
          `triggering task at ${new Date(
            task.timestamp * 1000
          ).toISOString()}: ${task.task}`
        );

        try {
          await this.processTask(task);
        } catch (error) {
          debugKeepWorker("failed to process task:", error);
        }
      }
    } catch (err) {
      debugKeepWorker("error:", err);
    }
  }

  private async processTask(task: Task): Promise<void> {
    let statusUpdaterInterval: ReturnType<typeof setInterval> | undefined;
    try {
      if (task.state !== "") {
        debugKeepWorker("Task already processed with state:", task.state);
        return;
      }

      // Use existing thread_id from database if available, otherwise generate new one
      const threadId = task.thread_id || generateId();

      let mode: AGENT_MODE = "task";
      switch (task.type) {
        case "planner":
          mode = "planner";
          task.task = createPlannerTaskPrompt();
          break;
        case "message":
          mode = "user";
          break;
      }

      // Set agent status in db
      const status: AGENT_STATUS = mode;
      const update = async () => {
        debugKeepWorker(`Update agent status: '${status}'`);
        await this.api.setAgentStatus(status);
      };
      statusUpdaterInterval = setInterval(
        update,
        Math.max(10000, MAX_STATUS_TTL - 5000)
      );
      await update();

      // Get existing messages for this thread
      let originalMessages: AssistantUIMessage[] = [];
      try {
        originalMessages = await this.api.memoryStore.getMessages({ threadId });
      } catch {}

      let taskMessage: AssistantUIMessage | undefined;
      if (task.type === "message") {
        // Fetch thread up until the target message
        const index = originalMessages.findIndex((m) => m.id === task.task);
        if (index < 0) {
          debugKeepWorker("Task message not found", task.task, task.thread_id);
          await this.api.taskStore.finishTask(
            task.id,
            threadId,
            "",
            "Message not found"
          );
          return;
        }

        // Expecting user message
        const msg = originalMessages[index];
        if (msg.role !== "user") {
          debugKeepWorker(
            "Task message is not by user",
            msg.id,
            msg.metadata?.threadId,
            msg.role
          );
          await this.api.taskStore.finishTask(
            task.id,
            threadId,
            "",
            "Message not by user"
          );
          return;
        }

        // crop messages to the target one
        originalMessages.length = index + 1;
      } else {
        // Create task message
        taskMessage = {
          id: generateId(),
          role: "user",
          parts: [{ type: "text", text: task.task }],
          metadata: {
            createdAt: new Date().toISOString(),
            threadId,
          },
        };

        originalMessages.push(taskMessage);
      }

      // Convert to model format
      const messages = convertToModelMessages(originalMessages);

      // Create toolset
      const toolset = makeToolset({
        chatStore: this.api.chatStore,
        memoryStore: this.api.memoryStore,
        noteStore: this.api.noteStore,
        taskStore: this.api.taskStore,
      });

      const agent = await makeAgent({
        mode,
        stepLimit: this.stepLimit,
        tools: toolset,
        memoryStore: this.api.memoryStore,
      });

      try {
        // Ensure thread exists
        const now = new Date();
        let thread = await this.api.memoryStore.getThread(threadId);
        if (!thread) {
          thread = {
            id: threadId,
            created_at: now,
            updated_at: now,
            title: "",
          };
          await this.api.memoryStore.saveThread(thread);
        }

        // Use task.task as input message to the agent
        const result = agent.stream({ messages });

        const newMessages: AssistantUIMessage[] = [];
        let responseId = "";
        await new Promise<void>(async (ok) => {
          const stream = result.toUIMessageStream({
            originalMessages,
            generateMessageId: generateId,
            messageMetadata(options): MessageMetadata {
              return {
                createdAt: new Date().toISOString(),
                threadId,
              };
            },
            // onError: (e) => {
            //   console.error("agent error", e);
            //   return "Error in prompt processing";
            // },
            onFinish: async ({ responseMessage }) => {
              if (taskMessage) {
                newMessages.push(taskMessage);
              }
              newMessages.push(responseMessage);
              responseId = responseMessage.id;
            },
          });
          for await (const _ of stream);
          // console.log("RESPONSE", JSON.stringify((await result.response).messages, null, 2));
          ok();
        });

        // Save messages using our new method
        await this.api.memoryStore.saveMessages(newMessages);

        // Take response.text and write to task's 'reply' field
        const responseText =
          task.type === "message"
            ? responseId
            : (await result.text) || "Task completed";

        if (task.cron) {
          const job = new Cron(task.cron);
          const nextRun = job.nextRun();
          if (!nextRun) throw new Error("Invalid cron schedule");

          const timestamp = Math.floor(nextRun.getTime() / 1000);
          // Update the current task with the next run timestamp
          await this.api.taskStore.updateTask({
            ...task,
            timestamp,
            thread_id: "", // Reset to start from scratch
            reply: responseText, // Reset reply for next run
            state: "", // Reset state for next run
            error: "", // Clear any previous errors
          });
          debugKeepWorker(
            `Updated cron task ${task.id} for next run at: ${new Date(
              timestamp * 1000
            ).toISOString()}`
          );
        } else {
          // Single-shot task finished
          await this.api.taskStore.finishTask(
            task.id,
            threadId,
            responseText,
            ""
          );
        }

        debugKeepWorker(`task processed successfully:`, {
          success: true,
          reply: responseText,
          threadId: threadId,
        });
      } catch (error) {
        debugKeepWorker("Task processing error:", error);

        // On exception, update the task with error and retry timestamp instead of finish+add
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        // Re-schedule the same task with different retry intervals based on type,
        // message: 10 sec,
        // task: 60 sec,
        // planner: 600 sec
        const retryDelaySeconds =
          task.type === "message" ? 10 : task.type ? 60 : 600;
        const retryTimestamp =
          Math.floor(Date.now() / 1000) + retryDelaySeconds;

        // FIXME reusing thread_id doesn't help much since we're only writing down agent replies
        // in onFinish which means only if everything goes well, so on failure the thread will still be empty

        // Update the current task instead of finishing and adding a new one
        await this.api.taskStore.updateTask({
          ...task,
          timestamp: retryTimestamp,
          reply: "",
          state: "", // Keep state empty so it can be retried
          error: errorMessage, // Set the error message
          thread_id: threadId, // Update thread_id if it was generated
        });

        debugKeepWorker(
          `Updated ${task.type || "regular"} task ${
            task.id
          } for retry at timestamp ${retryTimestamp} (retry in ${retryDelaySeconds} seconds) with error: ${errorMessage}`
        );

        throw error; // Re-throw to be caught by caller
      }
    } catch (error) {
      debugKeepWorker("Task processing error:", error);
      throw error;
    } finally {
      if (statusUpdaterInterval) clearInterval(statusUpdaterInterval);
      debugKeepWorker(`Clear agent status`);
      await this.api.setAgentStatus("");
    }
  }
}
