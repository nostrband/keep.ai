# Spec: Add pauseAllWorkflows SQL method

## Problem

In `apps/web/src/App.tsx`, the pause-all-automations handler fetches all workflows, then updates them one by one in a loop. This has several issues:

1. **Slow** - N database operations for N workflows
2. **Race conditions** - full object updates can overwrite concurrent modifications
3. **Partial failures** - if one update fails, some workflows are paused, others aren't
4. **Limit issues** - `listWorkflows()` caps at 100 by default

## Solution

Add a `pauseAllWorkflows()` method to script-store that uses a single SQL UPDATE statement:

```sql
UPDATE workflows SET status = 'disabled' WHERE status = 'active'
```

The method should return the number of workflows affected.

The IPC handler in App.tsx then simplifies to a single method call.

## Expected Outcome

- Single atomic database operation pauses all active workflows
- No partial failure states - either all succeed or none do
- Fast regardless of workflow count
- No race conditions with concurrent modifications
- No workflow count limits

## Considerations

- May want to also notify tables changed for UI refresh
- Consider whether to add a matching `resumeAllWorkflows()` method
- Return value (count of paused workflows) could be shown in a toast notification
