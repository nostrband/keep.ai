# Spec: Migrate schedule.ts to updateWorkflowFields

## Problem

In `packages/agent/src/ai-tools/schedule.ts`, the code still uses the old spread pattern with `updateWorkflow`:

```typescript
const updatedWorkflow: Workflow = {
  ...workflow,
  cron: info.cron,
  next_run_timestamp: nextRunTimestamp,
};
await opts.scriptStore.updateWorkflow(updatedWorkflow);
```

This pattern:
- Is inconsistent with other code that uses `updateWorkflowFields`
- Could cause race conditions if another process modifies the workflow between the read and write
- Spreads all fields when only 2 need updating

## Solution

Replace the spread pattern with a direct call to `updateWorkflowFields`:

```typescript
await opts.scriptStore.updateWorkflowFields(workflow.id, {
  cron: info.cron,
  next_run_timestamp: nextRunTimestamp,
});
```

## Expected Outcome

- Consistent usage of `updateWorkflowFields` across codebase
- Only specified fields are updated (atomic partial update)
- Reduced risk of race conditions

## Considerations

- Verify schedule.ts doesn't need the updated workflow object returned (if it does, may need to re-fetch or adjust the API)
