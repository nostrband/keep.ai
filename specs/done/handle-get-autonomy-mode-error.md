# Spec: Handle getAutonomyMode Error in TaskWorker

## Problem

In task-worker.ts, the call to `getAutonomyMode()` has no error handling. If the database query fails, the entire task execution fails and gets retried, even though the autonomy mode is just a preference setting.

## Solution

Add try-catch around the `getAutonomyMode()` call with a fallback to the default 'ai_decides' mode.

## Expected Outcome

- Task execution continues even if autonomy mode cannot be retrieved
- Fallback to 'ai_decides' (the default behavior)
- Error is logged for debugging but doesn't block task execution

## Considerations

- Keep debug logging to track when fallback is used
