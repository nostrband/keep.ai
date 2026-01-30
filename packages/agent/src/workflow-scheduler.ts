import debug from "debug";
import { KeepDbApi } from "@app/db";
import { WorkflowWorker } from "./workflow-worker";
import { WorkflowExecutionSignal, WorkflowRetryState } from "./workflow-worker-signal";
import { isValidEnv } from "./env";
import { Cron } from "croner";
import type { ConnectionManager } from "@app/connectors";

export interface WorkflowSchedulerConfig {
  api: KeepDbApi;
  userPath?: string; // path to user files directory
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
}

export class WorkflowScheduler {
  private api: KeepDbApi;
  private worker: WorkflowWorker;
  private userPath?: string;
  public readonly connectionManager?: ConnectionManager;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private interval?: ReturnType<typeof setInterval>;

  // Workflow state map for retry backoff (reset on program restart)
  private workflowRetryState: Map<string, WorkflowRetryState> = new Map();

  // Global pause for PAYMENT_REQUIRED errors
  private globalPauseUntil: number = 0;

  // Maximum number of consecutive network error retries before escalating to user
  // After this many retries, the workflow needs user attention
  private static readonly MAX_NETWORK_RETRIES = 5;

  private debug = debug("agent:WorkflowScheduler");

  constructor(config: WorkflowSchedulerConfig) {
    this.api = config.api;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;

    // Create worker with signal handler
    this.worker = new WorkflowWorker({
      ...config,
      onSignal: (signal) => this.handleWorkerSignal(signal),
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
          nextStart: 0,
          originalRunId: signal.scriptRunId || '', // Track the first failed run
        };

        // Increment retry count
        currentState.retryCount += 1;

        // If this is a new retry chain (first failure), set the original run ID
        // Otherwise keep the existing originalRunId (it's the first failure in the chain)
        if (!currentState.originalRunId && signal.scriptRunId) {
          currentState.originalRunId = signal.scriptRunId;
        }

        // Check if max retries exceeded - escalate to user attention
        if (currentState.retryCount > WorkflowScheduler.MAX_NETWORK_RETRIES) {
          // Log with error context like 'needs_attention' case for consistency
          this.debug(
            `Workflow ${signal.workflowId} exceeded max retries (${currentState.retryCount}/${WorkflowScheduler.MAX_NETWORK_RETRIES}), escalating to user attention (${signal.errorType || 'network'}): ${signal.error || 'Max retries exceeded'}`
          );

          // Mark workflow as error status so user can see it needs attention
          // Use updateWorkflowFields to only update status, preserving all other fields
          // Note: The script_run already has error_type='network' from the last failed attempt,
          // which triggers WorkflowNotifications when the workflows table changes
          this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
            status: 'error',
          }).then(() => {
            // Clear retry state only after successful DB update
            this.workflowRetryState.delete(signal.workflowId);
          }).catch(err => this.debug('Failed to update workflow status:', err));
          break;
        }

        // Calculate exponential backoff
        const baseDelayMs = 10 * 1000; // 10 seconds in milliseconds
        const exponentialDelayMs = baseDelayMs * Math.pow(2, currentState.retryCount - 1);
        const maxDelayMs = 10 * 60 * 1000; // 10 minutes in milliseconds
        const actualDelayMs = Math.min(exponentialDelayMs, maxDelayMs);

        // Set next start time
        currentState.nextStart = Date.now() + actualDelayMs;
        this.workflowRetryState.set(signal.workflowId, currentState);

        this.debug(
          `Workflow ${signal.workflowId} retry scheduled in ${actualDelayMs}ms (attempt ${currentState.retryCount}/${WorkflowScheduler.MAX_NETWORK_RETRIES}, originalRunId: ${currentState.originalRunId})`
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
    // Set shutdown flag to prevent new work from starting
    this.isShuttingDown = true;

    // Clear interval to stop scheduling new checkWork calls
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    // Wait for in-progress work to complete with timeout
    const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds
    const POLL_INTERVAL_MS = 100;
    const startTime = Date.now();

    while (this.isRunning) {
      if (Date.now() - startTime > SHUTDOWN_TIMEOUT_MS) {
        this.debug("Warning: Shutdown timeout reached with work still in progress");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    this.debug("Scheduler closed");
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
        this.debug("Authentication required, pausing workflow processing (reason: %s)", needAuthState.reason);
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
      // Get workflows and check if any should run
      processed = await this.processNextWorkflow();
    } catch (e) {
      this.debug("Error processing workflow:", e);
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
      
      // Filter active workflows - per spec 06, only workflows with status="active" run
      // Draft ("draft"), Ready ("ready"), Paused ("paused"), and Error ("error") workflows do not run on schedule
      const activeWorkflows = allWorkflows.filter(
        (w) => w.status === 'active' && !w.maintenance
      );

      this.debug(`Found ${activeWorkflows.length} active workflows`);

      // Check which workflows should run based on next_run_timestamp
      const currentTime = Date.now();
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
        const retryState = this.workflowRetryState.get(workflow.id);

        this.debug(
          `Triggering workflow: ${workflow.title} (${workflow.id})`,
          retryState ? `(retry #${retryState.retryCount} of ${retryState.originalRunId})` : '(fresh run)'
        );

        try {
          // Pass retry info to worker if this is a retry
          await this.worker.executeWorkflow(
            workflow,
            retryState?.originalRunId || '',
            retryState?.retryCount || 0
          );
          
          // After execution, calculate and update next_run_timestamp from cron if available
          // Use updateWorkflowFields to only update specific fields atomically,
          // preventing concurrent updates (e.g., user pause) from being overwritten
          if (workflow.cron && workflow.cron.trim() !== '') {
            try {
              const cronJob = new Cron(workflow.cron);
              const nextRun = cronJob.nextRun();

              if (nextRun) {
                // Note: Only update next_run_timestamp, not timestamp.
                // workflow.timestamp is the creation time; script_runs track execution times.
                await this.api.scriptStore.updateWorkflowFields(workflow.id, {
                  next_run_timestamp: nextRun.toISOString(),
                });
                this.debug(
                  `Updated workflow ${workflow.id} next_run_timestamp to ${nextRun.toISOString()}`
                );
              } else {
                // Clear next_run_timestamp if cron has no next run
                await this.api.scriptStore.updateWorkflowFields(workflow.id, {
                  next_run_timestamp: '',
                });
              }
            } catch (error) {
              this.debug(`Error calculating next run for workflow ${workflow.id}:`, error);
              // Mark workflow as error - only update the error-related fields
              await this.api.scriptStore.updateWorkflowFields(workflow.id, {
                status: 'error',
                next_run_timestamp: '',
              });
            }
          } else {
            // No cron expression, clear next_run_timestamp
            await this.api.scriptStore.updateWorkflowFields(workflow.id, {
              next_run_timestamp: '',
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
