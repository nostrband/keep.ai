# Fix: Test Run Tracking Memory Leak and Missing Timeout

## Source
- Reviews: `reviews/e25edd7.txt`, `reviews/223ef9f.txt`
- Commits: `e25edd7`, `223ef9f`
- Severity: HIGH

## Problem

In `apps/server/src/server.ts`, the `inProgressTestRuns` Map has two issues:

### Issue 1: Map entry set before WorkflowWorker construction

The Map entry is set on line 1380 BEFORE WorkflowWorker is constructed on line 1384. If the constructor throws, the `.finally()` cleanup (line 1405) never runs because the promise chain was never created, permanently blocking that workflow from test runs.

```typescript
// Line 1380: Entry added to map
inProgressTestRuns.set(workflow.id, scriptRunId);

// Line 1384: WorkflowWorker construction (could throw)
const testWorker = new WorkflowWorker({...});

// Lines 1405-1409: Only the promise chain has cleanup
testWorker.executeWorkflow(...).finally(() => {
  inProgressTestRuns.delete(workflow.id);
});
```

### Issue 2: No timeout-based cleanup

If a test run hangs indefinitely, the Map entry persists forever, blocking that workflow from test runs. There is no safety net.

### Issue 3: Dynamic import on every request

Line 1376 uses `const { generateId } = await import("ai")` inside the handler, adding unnecessary overhead on every test-run request.

## Verification

Research confirmed all three issues still exist in the current codebase at lines 1376, 1380, 1384, and 1405-1409.

## Fix

### 1. Wrap construction in try-catch with cleanup

```typescript
inProgressTestRuns.set(workflow.id, scriptRunId);
try {
  const testWorker = new WorkflowWorker({
    api: new KeepDbApi(keepDB),
    userPath,
    gmailOAuth2Client,
  });

  const timeoutId = setTimeout(() => {
    if (inProgressTestRuns.get(workflow.id) === scriptRunId) {
      inProgressTestRuns.delete(workflow.id);
      debugServer(`Timeout cleanup for stuck test run ${scriptRunId}`);
    }
  }, 10 * 60 * 1000); // 10 minute max

  testWorker.executeWorkflow(...).finally(() => {
    clearTimeout(timeoutId);
    inProgressTestRuns.delete(workflow.id);
  });
} catch (error) {
  inProgressTestRuns.delete(workflow.id); // Cleanup on construction failure
  throw error;
}
```

### 2. Move generateId import to module level

```typescript
// At top of server.ts
import { generateId } from "ai";
```

## Files to Modify

1. `apps/server/src/server.ts` - Fix test-run endpoint handler

## Testing

- Test that a failed WorkflowWorker construction doesn't permanently block test runs
- Test that a hanging test run is automatically cleaned up after 10 minutes
- Verify generateId still works after moving to module-level import
