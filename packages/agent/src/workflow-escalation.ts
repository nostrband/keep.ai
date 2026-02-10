import { KeepDbApi, Workflow } from "@app/db";
import { ClassifiedError } from "./errors";

// Maximum number of consecutive fix attempts before escalating to user (spec 09b)
// After this many failed auto-fix attempts, the workflow is paused and user is notified.
export const MAX_FIX_ATTEMPTS = 3;

/**
 * Options for escalating a workflow to user attention.
 */
export interface EscalateToUserOptions {
  workflow: Workflow;
  scriptRunId: string;
  error: ClassifiedError;
  logs: string[];
  fixAttempts: number;
}

/**
 * Result of an escalation operation.
 */
export interface EscalateToUserResult {
  success: boolean;
  notificationCreated: boolean;
  messageCreated: boolean;
}

/**
 * Escalates a workflow to user after max fix attempts have been exceeded.
 *
 * This function:
 * 1. Sets workflow status to "error" and clears maintenance
 * 2. Resets fix count (gives user fresh attempts when re-enabled)
 * 3. Creates an "escalated" notification
 * 4. Sends a message to user's chat explaining the issue
 *
 * @param api - Database API for making changes
 * @param options - Escalation options including workflow, error info, etc.
 * @returns Result indicating what actions were taken
 */
export async function escalateToUser(
  api: KeepDbApi,
  options: EscalateToUserOptions
): Promise<EscalateToUserResult> {
  const { workflow, scriptRunId, error, logs, fixAttempts } = options;

  const result: EscalateToUserResult = {
    success: true,
    notificationCreated: false,
    messageCreated: false,
  };

  // 1. Set workflow to error status and reset fix count (gives user a fresh start)
  await api.scriptStore.updateWorkflowFields(workflow.id, {
    status: "error",
    maintenance: false,
    maintenance_fix_count: 0,
  });

  // 2. Create an "escalated" notification
  try {
    await api.notificationStore.saveNotification({
      id: crypto.randomUUID(),
      workflow_id: workflow.id,
      type: "escalated",
      payload: JSON.stringify({
        script_run_id: scriptRunId,
        error_type: error.type,
        error_message: error.message,
        fix_attempts: fixAttempts,
        max_fix_attempts: MAX_FIX_ATTEMPTS,
      }),
      timestamp: new Date().toISOString(),
      acknowledged_at: "",
      resolved_at: "",
      workflow_title: workflow.title,
    });
    result.notificationCreated = true;
  } catch {
    result.notificationCreated = false;
  }

  // 3. Send message to user's chat if we can find the task
  if (workflow.task_id) {
    try {
      const task = await api.taskStore.getTask(workflow.task_id);
      if (task?.chat_id) {
        const recentLogs = logs.slice(-20).join("\n");
        const escalationMessage = `**Automation Paused: Manual Intervention Required**

I've tried to automatically fix this workflow ${fixAttempts} times, but the same issue keeps occurring. I've paused the automation to prevent further problems.

**Error:** ${error.message}
**Error Type:** ${error.type}

**Recent Logs:**
\`\`\`
${recentLogs || "(no logs)"}
\`\`\`

**What you can do:**
1. Review the error and logs above
2. Check if there's a fundamental issue with the automation logic
3. Update the script manually if needed
4. Re-enable the automation when ready

If you'd like me to try fixing it again, just ask and I'll give it another go with fresh context.`;

        await api.addMessage({
          chatId: task.chat_id,
          content: escalationMessage,
          role: "assistant",
        });
        result.messageCreated = true;
      }
    } catch {
      result.messageCreated = false;
    }
  }

  return result;
}
