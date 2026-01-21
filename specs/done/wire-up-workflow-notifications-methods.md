# Spec: Wire Up WorkflowNotifications Methods

## Problem

WorkflowNotifications.ts has methods defined but never called:
- `clearWorkflowNotifications(workflowId)` - intended to clear when user views a workflow
- `reset()` - intended to reset state on logout/app restart
- `checkIntervalMs` property - declared but never used

This indicates incomplete implementation - notifications cannot be cleared when the user addresses them.

## Solution

Wire up the existing methods to appropriate triggers:
- Call `clearWorkflowNotifications()` from WorkflowDetailPage when user views a workflow with errors
- Call `reset()` on app logout or full reload
- Either use or remove `checkIntervalMs` property

## Expected Outcome

- Viewing a workflow clears its notification state
- User is not re-notified for errors they've already seen
- No dead code in the notification service

## Considerations

- Determine appropriate places to call these methods
- Consider if `checkIntervalMs` was intended for polling and whether it's still needed
