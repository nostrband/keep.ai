# Spec: Add Null Check in ArchivedPage Restore Logic

## Problem

In ArchivedPage.tsx, the restore handler uses `workflows.find()` to look up the workflow before determining the restore status. If the workflow is not found (due to race condition, data sync issue, or stale cache), the code silently defaults to "draft" status:

```typescript
const workflow = workflows.find(w => w.id === workflowId);
const restoreStatus = workflow?.active_script_id ? "paused" : "draft";
```

The optional chaining returns undefined (falsy) when workflow is not found, always defaulting to "draft" with no error handling or user feedback.

## Solution

Add explicit null check before proceeding with the restore operation. If workflow is not found, show an error message to the user and abort the restore.

## Expected Outcome

- If workflow is not found in local cache, user sees an error message
- Restore operation is aborted rather than proceeding with potentially wrong state
- No silent failures - user is informed of the issue

## Considerations

- The same issue may exist in WorkflowDetailPage.tsx restore logic - check and fix both
- Consider whether the error should prompt a cache refresh
