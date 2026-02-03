# Spec: Make Scheduler close() Wait for In-Progress Work

## Problem

Both `TaskScheduler` and `WorkflowScheduler` have `close()` methods that only set flags and clear intervals but don't wait for in-progress work to complete:

```typescript
async close(): Promise<void> {
  if (!this.isRunning) return;
  this.isShuttingDown = true;
  if (this.interval) clearInterval(this.interval);
  // Does NOT wait for checkWork() to finish
}
```

If `checkWork()` is running when `close()` is called:
- Tasks/workflows may attempt to execute while resources are being torn down
- Database operations may occur after database is closed
- Transport operations may occur after transports are stopped

## Solution

Enhance the scheduler `close()` methods to wait for any in-progress work to complete before returning. Use a polling loop with a reasonable timeout to avoid hanging forever.

Key elements:
- Clear the interval to stop new work from being scheduled
- Poll until `isRunning` becomes false (work completed) or timeout expires
- Log a warning if timeout is reached with work still in progress

## Expected Outcome

- Server shutdown waits for in-progress scheduler work to complete
- No database/transport operations after those resources are closed
- Clean shutdown without race conditions
- Timeout prevents hanging indefinitely if work is stuck

## Considerations

- Choose appropriate timeout value (e.g., 30 seconds)
- Both TaskScheduler and WorkflowScheduler need the same change
- May need to track whether `checkWork()` is currently running with a separate flag
