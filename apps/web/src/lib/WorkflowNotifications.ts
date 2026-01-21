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
// - 'internal' errors are bugs in our code that users should be aware of
// - Empty string ('') handles legacy/unclassified errors for consistency with MainPage attention indicators
const NOTIFY_ERROR_TYPES = ['auth', 'permission', 'network', 'internal', ''];

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

      // Batch fetch latest runs for all workflows in a single query
      const workflowIds = workflows.map(w => w.id);
      const latestRunsMap = await api.scriptStore.getLatestRunsByWorkflowIds(workflowIds);

      // Check each workflow's latest run for errors
      for (const workflow of workflows) {
        const latestRun = latestRunsMap.get(workflow.id) || null;

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
      }

      // Update tray badge with attention count
      try {
        await window.electronAPI.updateTrayBadge(workflowsNeedingAttention.length);
      } catch (e) {
        console.debug("Failed to update tray badge:", e);
      }

      // Only show notifications if tab is not visible
      if (globalThis.document?.visibilityState === 'visible') {
        return;
      }

      // Group workflows by error type for batch notifications
      // This prevents notification spam when multiple workflows fail with the same error type
      const errorTypeGroups = new Map<string, Array<{
        workflow: Workflow;
        latestRun: ScriptRun;
        notificationKey: string;
      }>>();

      for (const { workflow, latestRun, shouldNotify } of workflowsNeedingAttention) {
        if (!shouldNotify || !latestRun) continue;

        // Create a unique key for this specific error
        const notificationKey = `${workflow.id}:${latestRun.id}`;

        // Skip if we've already notified about this specific run
        if (this.notifiedWorkflows.has(notificationKey)) {
          continue;
        }

        // Group by error type
        const errorType = latestRun.error_type || '';
        const group = errorTypeGroups.get(errorType) || [];
        group.push({ workflow, latestRun, notificationKey });
        errorTypeGroups.set(errorType, group);
      }

      // Send one notification per error type group
      for (const [errorType, workflows] of errorTypeGroups) {
        if (workflows.length === 0) continue;

        try {
          const { title, body } = this.buildGroupedNotificationContent(errorType, workflows);

          // For click navigation:
          // - If single workflow, navigate to that workflow's detail page
          // - If multiple workflows, navigate to workflows list page
          const workflowId = workflows.length === 1 ? workflows[0].workflow.id : undefined;

          await window.electronAPI.showNotification({
            title,
            body,
            workflowId,
          });

          // Mark all workflows in this group as notified
          for (const { notificationKey } of workflows) {
            this.notifiedWorkflows.add(notificationKey);
          }

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
   * Build notification title and body for a group of workflows with the same error type.
   * Groups errors to reduce notification spam (e.g., "3 workflows need authentication").
   */
  private buildGroupedNotificationContent(
    errorType: string,
    workflows: Array<{ workflow: Workflow; latestRun: ScriptRun }>
  ): { title: string; body: string } {
    const count = workflows.length;

    // Single workflow - use workflow-specific title and message
    if (count === 1) {
      const { workflow, latestRun } = workflows[0];
      const title = `${workflow.title || 'Workflow'} needs attention`;
      let body = latestRun.error || 'An error occurred';

      // Make the message more user-friendly based on error type
      if (errorType === 'auth') {
        body = 'Authentication expired. Please reconnect.';
      } else if (errorType === 'permission') {
        body = 'Permission denied. Please check access settings.';
      } else if (errorType === 'network') {
        body = 'Network error. The service may be temporarily unavailable.';
      } else if (errorType === 'internal') {
        body = 'An internal error occurred.';
      }

      return { title, body };
    }

    // Multiple workflows - use grouped title and include workflow names
    let title: string;
    let actionHint: string;

    switch (errorType) {
      case 'auth':
        title = `${count} workflows need authentication`;
        actionHint = 'Please reconnect to continue.';
        break;
      case 'permission':
        title = `${count} workflows have permission errors`;
        actionHint = 'Please check access settings.';
        break;
      case 'network':
        title = `${count} workflows have network errors`;
        actionHint = 'Services may be temporarily unavailable.';
        break;
      case 'internal':
        title = `${count} workflows have internal errors`;
        actionHint = 'An unexpected error occurred.';
        break;
      default:
        title = `${count} workflows need attention`;
        actionHint = 'Please review the errors.';
    }

    // Build body with workflow names (truncate if too many)
    const MAX_NAMES_IN_BODY = 3;
    const workflowNames = workflows
      .slice(0, MAX_NAMES_IN_BODY)
      .map(w => w.workflow.title || 'Untitled')
      .join(', ');

    let body: string;
    if (count <= MAX_NAMES_IN_BODY) {
      body = `${workflowNames}. ${actionHint}`;
    } else {
      const remaining = count - MAX_NAMES_IN_BODY;
      body = `${workflowNames} and ${remaining} more. ${actionHint}`;
    }

    return { title, body };
  }

  /**
   * Clear notification state for a specific workflow
   * Call this when user views the workflow
   */
  clearWorkflowNotifications(workflowId: string): void {
    // Collect keys to delete first to avoid modifying Set during iteration
    // Deleting from a Set while iterating is undefined behavior and can skip entries
    const prefix = `${workflowId}:`;
    const keysToDelete = [...this.notifiedWorkflows].filter(key => key.startsWith(prefix));
    keysToDelete.forEach(key => this.notifiedWorkflows.delete(key));
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
