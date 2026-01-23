import debug from "debug";
import { KeepDbApi, InboxItem } from "@app/db";
import { TaskWorker } from "./task-worker";
import { TaskExecutionSignal, TaskRetryState } from "./task-worker-signal";
import { isValidEnv } from "./env";
import type { ConnectionManager } from "@app/connectors";

export interface TaskSchedulerConfig {
  api: KeepDbApi;
  stepLimit?: number; // default 50
  userPath?: string; // path to user files directory
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
}

export class TaskScheduler {
  private api: KeepDbApi;
  private worker: TaskWorker;
  private userPath?: string;
  public readonly connectionManager?: ConnectionManager;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  // Task state map for retry backoff (reset on program restart)
  private taskRetryState: Map<string, TaskRetryState> = new Map();

  // Global pause for PAYMENT_REQUIRED errors
  private globalPauseUntil: number = 0;

  private debug = debug("agent:TaskScheduler");

  constructor(config: TaskSchedulerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;

    // Create worker with signal handler
    this.worker = new TaskWorker({
      ...config,
      onSignal: (signal) => this.handleWorkerSignal(signal),
    });

    this.debug("Constructed");
  }

  /**
   * Handle signals from the worker about execution outcomes
   */
  private handleWorkerSignal(signal: TaskExecutionSignal): void {
    this.debug("Received signal:", signal);

    switch (signal.type) {
      case 'retry':
        // Get or create retry state
        const currentState = this.taskRetryState.get(signal.taskId) || {
          retryCount: 0,
          nextStart: 0
        };

        // Increment retry count
        currentState.retryCount += 1;

        // Calculate exponential backoff
        const baseDelayMs = 10 * 1000; // 10 seconds in milliseconds
        const exponentialDelayMs = baseDelayMs * Math.pow(2, currentState.retryCount - 1);
        const maxDelayMs = 10 * 60 * 1000; // 10 minutes in milliseconds
        const actualDelayMs = Math.min(exponentialDelayMs, maxDelayMs);

        // Set next start time
        currentState.nextStart = Date.now() + actualDelayMs;
        this.taskRetryState.set(signal.taskId, currentState);

        this.debug(
          `Task ${signal.taskId} retry scheduled in ${actualDelayMs}ms (attempt ${currentState.retryCount})`
        );
        break;

      case 'payment_required':
        this.globalPauseUntil = Date.now() + 10 * 60 * 1000;
        this.debug(
          `Global pause active until ${new Date(this.globalPauseUntil).toISOString()}`
        );
        break;

      case 'done':
        this.taskRetryState.delete(signal.taskId);
        this.debug(`Task ${signal.taskId} completed successfully, retry state cleared`);
        break;
    }
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

    // Check if authentication is required (needAuth flag set in database)
    try {
      const needAuthState = await this.api.getNeedAuth();
      if (needAuthState.needed) {
        this.debug("Authentication required, pausing task processing (reason: %s)", needAuthState.reason);
        return;
      }
    } catch (e) {
      this.debug("Error checking needAuth state:", e);
      // Continue processing if we can't check the flag
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
      // Get task ids that have incoming mail
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

      return items;
    } catch (err) {
      this.debug("checkInbox error:", err);
      return [];
    }
  }

  private async processNextTask(inboxItems: InboxItem[]): Promise<boolean> {
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

      const receiverIds = inboxItems
        .map((i) => i.target_id)
        .filter((id) => !!id);
      const receiverTasks =
        receiverIds.length > 0
          ? await this.api.taskStore.getTasks(receiverIds)
          : [];

      // Dedup tasks
      const taskMap = new Map<string, any>();
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
      // - planner first
      let task = tasks.find((t) => t.type === "planner");
      // - worker next
      if (!task) task = tasks.find((t) => t.type === "worker");

      // Found anything?
      if (task) {
        this.debug(
          `triggering task at ${new Date(
            task.timestamp * 1000
          ).toISOString()}: ${task.title}`
        );

        try {
          await this.worker.executeTask(task);
        } catch (error) {
          this.debug("failed to process task:", error);
        }
      }

      return !!task;
    } catch (err) {
      this.debug("processNextTask error:", err);
      return false;
    }
  }
}
