# Spec: Remove TaskState struct entirely

## Problem
The TaskState concept is obsolete after Spec 10. The only useful field (`asks`) has been moved to the Task interface. However, TaskState still exists in multiple places:
- `packages/agent/src/agent-types.ts` - TaskState type with goal?, notes?, plan?, asks?
- `packages/db/src/task-store.ts` - TaskState interface and deprecated methods (saveState, getState, getStates)

This creates confusion, type collision issues, and dead code that should be cleaned up.

## Solution
Remove the TaskState struct and all related code from the codebase:
1. Delete TaskState type from agent-types.ts
2. Delete TaskState interface from task-store.ts
3. Remove deprecated saveState, getState, getStates methods
4. Remove any imports or references to TaskState
5. Update any code still using TaskState to use Task.asks directly

## Expected Outcome
- No TaskState type/interface in codebase
- No deprecated task_states table methods
- Cleaner codebase with single source of truth (Task.asks)
- No type confusion or naming collisions

## Considerations
- Search for all usages of TaskState before removal
- The task_states table can remain for historical data but methods should be removed
- May need to update tests that reference TaskState
