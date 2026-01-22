# Spec: Treat Workflow Timestamp as Creation Time Only

## Problem

The workflow `timestamp` field has confused semantics:
- UI displays it as "Created" time (WorkflowDetailPage, WorkflowsPage, TaskDetailPage)
- But workflow-scheduler.ts updates it on every successful execution (4 places)
- This makes the "Created" label inaccurate and the field's purpose unclear

Additionally, error paths don't update timestamp while success paths do, creating inconsistency.

## Solution

Stop updating `timestamp` in workflow-scheduler.ts. Treat `timestamp` as a true creation time that is set once when the workflow is created and never modified.

Remove the `timestamp` field from `updateWorkflowFields()` calls in workflow-scheduler.ts (approximately lines 275, 284, 293, 300).

## Expected Outcome

- `timestamp` reflects when the workflow was created, never changes after
- UI "Created" labels are now accurate
- `listWorkflows()` ORDER BY timestamp gives predictable creation-order sorting
- MainPage sorting continues to work (uses run timestamps with workflow.timestamp as fallback)
- Simpler code with fewer fields to update
- Inconsistency between success/error paths is eliminated

## Considerations

- Verify no other code depends on timestamp being "last executed" time
- Script runs table already tracks execution times, so no information is lost
