import { convertToModelMessages, generateId, ModelMessage } from "ai";
import { TaskStore, MemoryStore, ChatStore, NoteStore, Task } from "@app/db";
import { makeAgent, AGENT_MODE, createPlannerTaskPrompt } from "@app/agent";
import { makeToolset } from "@app/agent";
import { AssistantUIMessage } from "@app/proto";
import { Cron } from "croner";
import debug from "debug";

const debugKeepWorker = debug("worker:KeepWorker");

export interface KeepWorkerConfig {
  user_id: string;
  taskStore: TaskStore;
  memoryStore: MemoryStore;
  chatStore: ChatStore;
  noteStore: NoteStore;
  checkInterval?: number; // milliseconds, default 5000
  stepLimit?: number; // default 50
  routineTasks?: Record<string, string>; // taskType -> cronSchedule
}

export class KeepWorker {
  private user_id: string;
  private taskStore: TaskStore;
  private memoryStore: MemoryStore;
  private chatStore: ChatStore;
  private noteStore: NoteStore;
  private checkInterval: number;
  private stepLimit: number;
  private routineTasks: Record<string, string>;
  
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: KeepWorkerConfig) {
    this.user_id = config.user_id;
    this.taskStore = config.taskStore;
    this.memoryStore = config.memoryStore;
    this.chatStore = config.chatStore;
    this.noteStore = config.noteStore;
    this.checkInterval = config.checkInterval || 5000;
    this.stepLimit = config.stepLimit || 50;
    this.routineTasks = config.routineTasks || {};
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      debugKeepWorker('Already running');
      return;
    }

    this.isRunning = true;
    this.isShuttingDown = false;

    debugKeepWorker('Starting worker...');

    try {
      // Initialize routine tasks before starting polling
      await this.initializeRoutineTasks();
      
      // Start the task checking loop
      this.scheduleNextCheck();
      
      debugKeepWorker('Worker started successfully');
    } catch (error) {
      debugKeepWorker('Failed to start worker:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.isRunning) {
      debugKeepWorker('Already stopped');
      return;
    }

    debugKeepWorker('Stopping worker...');
    this.isShuttingDown = true;
    this.isRunning = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    debugKeepWorker('Worker stopped');
  }

  private async initializeRoutineTasks(): Promise<void> {
    try {
      debugKeepWorker('Checking routine tasks...');

      for (const [taskType, cronSchedule] of Object.entries(this.routineTasks)) {
        debugKeepWorker(`Checking for ${taskType} task with cron schedule: ${cronSchedule}`);
        
        try {
          // Check if a task with this type and non-empty cron already exists
          const existingTask = await this.taskStore.hasCronTaskOfType(taskType);
          
          if (!existingTask) {
            debugKeepWorker(`No ${taskType} cron task found, creating one`);
            
            // First run immediately
            const timestamp = Math.floor(Date.now() / 1000);
            
            // Create task content based on type
            let taskContent = '';
            let title = '';
            if (taskType === 'planner') {
              title = 'Daily Planning';
            }
            
            await this.taskStore.addTask(
              generateId(),
              timestamp,
              taskContent,
              taskType,
              '', // thread_id
              title,
              cronSchedule
            );
            
            debugKeepWorker(`Created ${taskType} cron task for next run at: ${new Date(timestamp * 1000).toISOString()}`);
          } else {
            debugKeepWorker(`${taskType} cron task already exists`);
          }
        } catch (error) {
          debugKeepWorker(`Error processing ${taskType} routine task:`, error);
        }
      }
    } catch (error) {
      debugKeepWorker('Error initializing routine tasks:', error);
    }
  }

  private scheduleNextCheck(): void {
    if (this.isShuttingDown) return;

    this.timeoutId = setTimeout(() => {
      this.checkTasks().catch(error => {
        debugKeepWorker('Error in checkTasks:', error);
      }).finally(() => {
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
      const task = await this.taskStore.getNextTask();
      
      if (task) {
        debugKeepWorker(`triggering task at ${new Date(task.timestamp * 1000).toISOString()}: ${task.task}`);
        
        try {
          await this.processTask(task);
        } catch (error) {
          debugKeepWorker('failed to process task:', error);
        }
      }
    } catch (err) {
      debugKeepWorker('error:', err);
    }
  }

  private async processTask(task: Task): Promise<void> {
    try {
      if (task.state !== "") {
        debugKeepWorker(
          "Task already processed with state:",
          task.state
        );
        return;
      }

      // Use existing thread_id from database if available, otherwise generate new one
      const threadId = task.thread_id || generateId();

      // Get existing messages for this thread
      let existingMessages: AssistantUIMessage[] = [];
      try {
        existingMessages = await this.memoryStore.getMessages({ threadId });
      } catch {}

      const messages = convertToModelMessages(existingMessages);
      const newMessage: ModelMessage = {
        role: "user",
        content: task.task,
      };
      messages.push(newMessage);

      // Set mode based on task type
      const mode: AGENT_MODE = task.type === "planner" ? "planner" : "task";
      if (mode === "planner") {
        task.task = createPlannerTaskPrompt();
      }

      // Create toolset
      const toolset = makeToolset({
        chatStore: this.chatStore,
        memoryStore: this.memoryStore,
        noteStore: this.noteStore,
        taskStore: this.taskStore,
        userId: this.user_id,
      });

      const agent = await makeAgent({
        mode,
        stepLimit: this.stepLimit,
        tools: toolset,
        memoryStore: this.memoryStore,
      });

      try {
        // Ensure thread exists
        const now = new Date();
        let thread = await this.memoryStore.getThread(threadId);
        if (!thread) {
          thread = {
            id: threadId,
            resourceId: this.user_id,
            createdAt: now,
            updatedAt: now,
            title: "",
          };
          await this.memoryStore.saveThread(thread);
        }

        // Use task.task as input message to the agent
        const result = await agent.generate({ messages });

        // Create UI messages for saving
        const userMessage: AssistantUIMessage = {
          id: generateId(),
          role: "user",
          parts: [{ type: "text", text: task.task }],
          metadata: {
            createdAt: now.toISOString(),
            threadId,
            resourceId: this.user_id,
          },
        };

        const assistantMessages: AssistantUIMessage[] =
          result.response.messages.map((msg, index) => ({
            id: generateId(),
            role: msg.role as "assistant",
            parts: [
              {
                type: "text",
                text:
                  typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content),
              },
            ],
            metadata: {
              createdAt: new Date(now.getTime() + index + 1).toISOString(),
              threadId,
              resourceId: this.user_id,
            },
          }));

        const allNewMessages = [userMessage, ...assistantMessages];

        // Save messages using our new method
        await this.memoryStore.saveMessages(allNewMessages);

        // Take response.text and write to task's 'reply' field
        const responseText = result.text || "Task completed";

        if (task.cron) {
          const job = new Cron(task.cron);
          const nextRun = job.nextRun();
          if (!nextRun) throw new Error("Invalid cron schedule");

          const timestamp = Math.floor(nextRun.getTime() / 1000);
          // Update the current task with the next run timestamp
          await this.taskStore.updateTask({
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
          await this.taskStore.finishTask(task.id, threadId, responseText, "");
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

        // Re-schedule the same task with different retry intervals based on type
        const retryDelaySeconds = !task.type ? 60 : 600; // 1 minute for user-created tasks, 10 minute for others
        const retryTimestamp = Math.floor(Date.now() / 1000) + retryDelaySeconds;

        // Update the current task instead of finishing and adding a new one
        await this.taskStore.updateTask({
          ...task,
          timestamp: retryTimestamp,
          reply: "",
          state: "", // Keep state empty so it can be retried
          error: errorMessage, // Set the error message
          thread_id: threadId, // Update thread_id if it was generated
        });

        debugKeepWorker(
          `Updated ${
            task.type || "regular"
          } task ${task.id} for retry at timestamp ${retryTimestamp} (retry in ${retryDelaySeconds} seconds) with error: ${errorMessage}`
        );

        throw error; // Re-throw to be caught by caller
      }
    } catch (error) {
      debugKeepWorker("Task processing error:", error);
      throw error;
    }
  }
}