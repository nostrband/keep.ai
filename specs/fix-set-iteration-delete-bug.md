# Spec: Fix Set iteration during deletion bug in WorkflowNotifications

## Problem

In `clearWorkflowNotifications()` in WorkflowNotifications.ts, the code deletes entries from a Set while iterating over it. This is undefined behavior in JavaScript that can cause some entries to be skipped, leading to memory leaks and preventing re-notification for genuinely new errors.

## Solution

Collect keys to delete first, then delete them after iteration completes, or use a different approach that doesn't modify the Set during iteration.

## Expected Outcome

- All matching notification keys are properly deleted when clearing workflow notifications
- No memory leaks from orphaned notification keys
- Users receive notifications for new errors after a workflow is cleared
