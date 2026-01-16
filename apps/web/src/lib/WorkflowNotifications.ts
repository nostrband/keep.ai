/**
 * WorkflowNotifications - Handles OS notifications for workflow errors
 *
 * Per spec 09 and 09b:
 * - Only notify for non-fixable errors (auth, permission, network)
 * - Do NOT notify for logic errors (agent handles silently via maintenance mode)
 * - Update tray badge with count of workflows needing attention
 */

import { KeepDbApi, Workflow, ScriptRun } from "@app/db";

// Error types that should trigger user notifications (non-fixable, require user action)
const NOTIFY_ERROR_TYPES = ['auth', 'permission', 'network'];

// Error types that should NOT trigger notifications (agent handles via maintenance)
const SILENT_ERROR_TYPES = ['logic'];

interface NotifiedWorkflow {
  workflowId: string;
  scriptRunId: string;
  timestamp: number;
}

export class WorkflowNotifications {
  private notifiedWorkflows: Set<string> = new Set(); // Track which workflows we've already notified
  private lastCheckTime: number = 0;
  private isRunning = false;
  private checkIntervalMs: number = 10000; // Check every 10 seconds

  /**
   * Check for workflows that need attention and trigger notifications
   * Call this periodically (e.g., after database changes)
   */
  async checkWorkflowsNeedingAttention(api: KeepDbApi): Promise<void> {
    // Skip if electron API not available
    if (!window.electronAPI) {
      return;
    }

    // Debounce: don't check more than once per second
    const now = Date.now();
    if (now - this.lastCheckTime < 1000) {
      return;
    }
    this.lastCheckTime = now;

    // Prevent concurrent checks
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      // Get all workflows
      const workflows = await api.scriptStore.listWorkflows();

      // Track workflows needing attention for badge update
      const workflowsNeedingAttention: Array<{
        workflow: Workflow;
        latestRun: ScriptRun | null;
        shouldNotify: boolean;
      }> = [];

      // Check each workflow's latest run for errors
      for (const workflow of workflows) {
        try {
          const runs = await api.scriptStore.getScriptRunsByWorkflowId(workflow.id);
          const latestRun = runs.length > 0 ? runs[0] : null;

          // Check if workflow is in maintenance mode (agent is auto-fixing)
          // Don't notify for workflows in maintenance - agent is handling it
          if (workflow.maintenance) {
            continue;
          }

          // Check if latest run has an error
          if (latestRun?.error) {
            const errorType = latestRun.error_type || '';

            // Determine if this should show a notification
            const shouldNotify = NOTIFY_ERROR_TYPES.includes(errorType);
            const isLogicError = errorType === 'logic' || SILENT_ERROR_TYPES.includes(errorType);

            // Only count non-logic errors as needing attention
            // Logic errors are handled by the agent in maintenance mode
            if (!isLogicError) {
              workflowsNeedingAttention.push({
                workflow,
                latestRun,
                shouldNotify,
              });
            }
          }
        } catch (e) {
          // Ignore individual workflow errors
        }
      }

      // Update tray badge with attention count
      try {
        await window.electronAPI.updateTrayBadge(workflowsNeedingAttention.length);
      } catch (e) {
        console.debug("Failed to update tray badge:", e);
      }

      // Show notifications for new errors that we haven't notified about yet
      for (const { workflow, latestRun, shouldNotify } of workflowsNeedingAttention) {
        if (!shouldNotify || !latestRun) continue;

        // Create a unique key for this specific error
        const notificationKey = `${workflow.id}:${latestRun.id}`;

        // Skip if we've already notified about this specific run
        if (this.notifiedWorkflows.has(notificationKey)) {
          continue;
        }

        // Only show notification if tab is not visible
        if (globalThis.document?.visibilityState === 'visible') {
          continue;
        }

        // Show the notification
        try {
          const errorType = latestRun.error_type || 'error';
          const title = `${workflow.title || 'Workflow'} needs attention`;
          let body = latestRun.error || 'An error occurred';

          // Make the message more user-friendly based on error type
          if (errorType === 'auth') {
            body = 'Authentication expired. Please reconnect.';
          } else if (errorType === 'permission') {
            body = 'Permission denied. Please check access settings.';
          } else if (errorType === 'network') {
            body = 'Network error. The service may be temporarily unavailable.';
          }

          await window.electronAPI.showNotification({
            title,
            body,
            workflowId: workflow.id,
          });

          // Mark as notified
          this.notifiedWorkflows.add(notificationKey);

          // Clean up old notification keys (keep last 100)
          if (this.notifiedWorkflows.size > 100) {
            const keysArray = Array.from(this.notifiedWorkflows);
            keysArray.slice(0, keysArray.length - 100).forEach(key => {
              this.notifiedWorkflows.delete(key);
            });
          }
        } catch (e) {
          console.debug("Failed to show workflow notification:", e);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clear notification state for a specific workflow
   * Call this when user views the workflow
   */
  clearWorkflowNotifications(workflowId: string): void {
    // Remove all notification keys for this workflow
    for (const key of this.notifiedWorkflows) {
      if (key.startsWith(`${workflowId}:`)) {
        this.notifiedWorkflows.delete(key);
      }
    }
  }

  /**
   * Reset all notification state
   */
  reset(): void {
    this.notifiedWorkflows.clear();
    this.lastCheckTime = 0;
  }
}

// Create a singleton instance
export const workflowNotifications = new WorkflowNotifications();
