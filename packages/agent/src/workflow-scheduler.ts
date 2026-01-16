import debug from "debug";
import { KeepDbApi } from "@app/db";
import { WorkflowWorker } from "./workflow-worker";
import { WorkflowExecutionSignal, WorkflowRetryState } from "./workflow-worker-signal";
import { isValidEnv } from "./env";
import { Cron } from "croner";

export interface WorkflowSchedulerConfig {
  api: KeepDbApi;
  userPath?: string; // path to user files directory
  gmailOAuth2Client?: any; // Gmail OAuth2 client
}

export class WorkflowScheduler {
  private api: KeepDbApi;
  private worker: WorkflowWorker;
  private userPath?: string;
  public readonly gmailOAuth2Client?: any;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  // Workflow state map for retry backoff (reset on program restart)
  private workflowRetryState: Map<string, WorkflowRetryState> = new Map();

  // Global pause for PAYMENT_REQUIRED errors
  private globalPauseUntil: number = 0;

  private debug = debug("agent:WorkflowScheduler");

  constructor(config: WorkflowSchedulerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.gmailOAuth2Client = config.gmailOAuth2Client;

    // Create worker with signal handler
    this.worker = new WorkflowWorker({
      ...config,
      onSignal: (signal) => this.handleWorkerSignal(signal)
    });

    this.debug("Constructed");
  }

  /**
   * Handle signals from the worker about execution outcomes
   */
  private handleWorkerSignal(signal: WorkflowExecutionSignal): void {
    this.debug("Received signal:", signal);

    switch (signal.type) {
      case 'retry':
        // Get or create retry state
        const currentState = this.workflowRetryState.get(signal.workflowId) || {
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
        this.workflowRetryState.set(signal.workflowId, currentState);

        this.debug(
          `Workflow ${signal.workflowId} retry scheduled in ${actualDelayMs}ms (attempt ${currentState.retryCount})`
        );
        break;

      case 'payment_required':
        this.globalPauseUntil = Date.now() + 10 * 60 * 1000;
        this.debug(
          `Global pause active until ${new Date(this.globalPauseUntil).toISOString()}`
        );
        break;

      case 'done':
        this.workflowRetryState.delete(signal.workflowId);
        this.debug(`Workflow ${signal.workflowId} completed successfully, retry state cleared`);
        break;

      case 'needs_attention':
        // User action required (auth/permission errors)
        // Clear retry state since retries won't help
        this.workflowRetryState.delete(signal.workflowId);
        this.debug(
          `Workflow ${signal.workflowId} needs user attention (${signal.errorType}): ${signal.error}`
        );
        break;

      case 'maintenance':
        // Workflow entered maintenance mode for agent auto-fix
        // Clear retry state - the workflow will be skipped until maintenance is cleared
        this.workflowRetryState.delete(signal.workflowId);
        this.debug(
          `Workflow ${signal.workflowId} entered maintenance mode for auto-fix (${signal.errorType}): ${signal.error}`
        );
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
      // Get workflows and check if any should run
      processed = await this.processNextWorkflow();
    } catch (e) {
      console.error("Error processing workflow", e);
    }

    // Done
    this.isRunning = false;

    // Retry immediately in case more workflows might need execution
    if (processed) this.checkWork();
  }

  private async processNextWorkflow(): Promise<boolean> {
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

      // Get all workflows
      const allWorkflows = await this.api.scriptStore.listWorkflows(1000, 0);
      
      // Filter active workflows (not disabled, error, or in maintenance mode)
      const activeWorkflows = allWorkflows.filter(
        (w) => w.status !== 'disabled' && w.status !== 'error' && !w.maintenance
      );

      this.debug(`Found ${activeWorkflows.length} active workflows`);

      // Check which workflows should run based on next_run_timestamp
      const currentTime = Date.now();
      const currentTimeISO = new Date(currentTime).toISOString();
      const dueWorkflows = [];

      for (const workflow of activeWorkflows) {
        // Check if next_run_timestamp is set and is in the past
        if (workflow.next_run_timestamp && workflow.next_run_timestamp.trim() !== '') {
          try {
            const nextRunTime = new Date(workflow.next_run_timestamp).getTime();
            
            // Check if workflow is due (next_run_timestamp <= current time)
            if (nextRunTime <= currentTime) {
              dueWorkflows.push(workflow);
              this.debug(
                `Workflow ${workflow.id} (${workflow.title}) is due: nextRun=${workflow.next_run_timestamp}`
              );
            }
          } catch (error) {
            this.debug(`Invalid next_run_timestamp for workflow ${workflow.id}:`, error);
          }
        }
      }

      // Filter out workflows in retry backoff
      const availableWorkflows = dueWorkflows.filter((w) => {
        const retryState = this.workflowRetryState.get(w.id);
        if (retryState && retryState.nextStart > currentTime) {
          this.debug(
            `Skipping workflow ${w.id} in backoff until ${new Date(
              retryState.nextStart
            ).toISOString()}`
          );
          return false;
        }
        return true;
      });

      this.debug(`${availableWorkflows.length} workflows ready to execute`);

      // Execute first available workflow
      if (availableWorkflows.length > 0) {
        const workflow = availableWorkflows[0];
        this.debug(
          `Triggering workflow: ${workflow.title} (${workflow.id})`
        );

        try {
          await this.worker.executeWorkflow(workflow);
          
          // After execution, calculate and update next_run_timestamp from cron if available
          if (workflow.cron && workflow.cron.trim() !== '') {
            try {
              const cronJob = new Cron(workflow.cron);
              const nextRun = cronJob.nextRun();
              
              if (nextRun) {
                await this.api.scriptStore.updateWorkflow({
                  ...workflow,
                  next_run_timestamp: nextRun.toISOString(),
                  timestamp: currentTimeISO, // Update last run timestamp
                });
                this.debug(
                  `Updated workflow ${workflow.id} next_run_timestamp to ${nextRun.toISOString()}`
                );
              } else {
                // Clear next_run_timestamp if cron has no next run
                await this.api.scriptStore.updateWorkflow({
                  ...workflow,
                  next_run_timestamp: '',
                  timestamp: currentTimeISO,
                });
              }
            } catch (error) {
              this.debug(`Error calculating next run for workflow ${workflow.id}:`, error);
              // Mark workflow as error
              await this.api.scriptStore.updateWorkflow({
                ...workflow,
                status: 'error',
                next_run_timestamp: '',
                timestamp: currentTimeISO,
              });
            }
          } else {
            // No cron expression, clear next_run_timestamp
            await this.api.scriptStore.updateWorkflow({
              ...workflow,
              next_run_timestamp: '',
              timestamp: currentTimeISO,
            });
          }
        } catch (error) {
          this.debug("failed to process workflow:", error);
        }

        return true;
      }

      return false;
    } catch (err) {
      this.debug("processNextWorkflow error:", err);
      return false;
    }
  }
}
