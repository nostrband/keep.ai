# Spec: Emit Signal on Max Retry Escalation

## Problem

When a workflow exceeds the maximum network retry limit in workflow-scheduler.ts, the code updates the workflow status to 'error' but does not emit a signal. This is inconsistent with auth/permission errors in workflow-worker.ts which emit a `'needs_attention'` signal with error type and context.

Without the signal:
- WorkflowNotifications system is not triggered
- No OS notification is shown to the user
- Tray badge is not updated
- Error context and original run ID are lost

## Solution

Emit a `'needs_attention'` signal when max retries are exceeded, similar to how auth/permission errors are handled. Include the error type ('network'), error message, workflow ID, and original script run ID.

## Expected Outcome

- Signal is emitted when max retries exceeded, before the break statement
- Signal includes: type 'needs_attention', workflowId, errorType 'network', error message, scriptRunId
- WorkflowNotifications picks up the signal and shows OS notification
- Tray badge updates to indicate workflow needs attention
- Consistent behavior with other error escalation paths

## Considerations

- Ensure the signal is emitted even if the database update fails (or coordinate with the state deletion fix)
- The original run ID should be available from the retry state (currentState.originalRunId)
