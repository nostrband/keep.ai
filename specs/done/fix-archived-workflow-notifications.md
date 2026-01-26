# Spec: Fix Archived Workflow Notifications

## Problem

The notification system in `WorkflowNotifications.ts` fetches all workflows and doesn't filter out archived ones. If an archived workflow had an error state, users would still receive notifications about a workflow they've intentionally hidden.

This defeats the purpose of the archive feature - users archive workflows to hide them from view, but they still get notified about them.

## Solution

Add a filter in the workflow notification loop to skip archived workflows:

```typescript
for (const workflow of workflows) {
  if (workflow.status === "archived") continue;
  // ... rest of notification logic
}
```

## Expected Outcome

- Archived workflows do not trigger notifications
- Users only receive notifications for workflows they haven't archived
- Archive feature properly hides workflows from all user-facing surfaces

## Considerations

- File: `apps/web/src/lib/WorkflowNotifications.ts`
- Simple one-line fix
- May want to audit other places that iterate over workflows to ensure archived are filtered appropriately
