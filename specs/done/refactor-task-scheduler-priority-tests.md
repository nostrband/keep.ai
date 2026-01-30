# Spec: Refactor Task Scheduler Priority Tests

## Problem

The task scheduler priority tests contain a `selectTaskByPriority()` helper function that duplicates the exact logic from `task-scheduler.ts`. This means:

- If production code changes, tests will still pass with outdated logic
- Tests don't actually verify the real scheduler implementation
- False confidence in test coverage

## Solution

Either:
1. Export the priority selection logic from task-scheduler.ts as a testable pure function, then test that function directly
2. Use integration tests that call the actual scheduler methods

Option 1 is preferred as it keeps tests focused and fast while testing real code.

## Expected Outcome

- Tests verify actual production code, not a duplicate
- Changes to scheduler priority logic are caught by tests
- No duplicated logic between test and production code

## Considerations

- May need to refactor task-scheduler.ts to expose the priority logic as a pure function
- Consider what dependencies need to be injected for testability
