# Spec: Use atomic workflow updates in save.ts

## Problem

In `/packages/agent/src/ai-tools/save.ts`, the code uses the spread pattern `{...workflow, ...}` to update workflow fields after maintenance mode is completed. The workflow object is fetched early in the function, and by the time the update occurs, the data may be stale.

If the workflow is modified between the fetch and the update (e.g., user pauses the workflow), those changes will be overwritten.

This is the same issue that was fixed in workflow-worker.ts and workflow-scheduler.ts as part of the workflow-state-consistency work, but save.ts was missed.

## Solution

Replace the `updateWorkflow({...workflow, ...})` call with `updateWorkflowFields()` which performs atomic partial updates, only modifying the specified fields.

## Expected Outcome

- Maintenance mode exit in save.ts uses atomic field updates
- Concurrent user actions (like pausing) are not overwritten
- Consistent with the pattern used in workflow-worker.ts and workflow-scheduler.ts

## Considerations

- Check if there are other places in save.ts or other AI tools that use the same stale-object pattern
