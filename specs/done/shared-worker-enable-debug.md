# Spec: Enable debug logging in shared-worker

## Problem

worker.ts enables debug logging in development mode with:
```typescript
if (typeof __DEV__ !== "undefined" && __DEV__) {
  debug.enable("*");
}
```

shared-worker.ts has no equivalent call. This means debug logs from shared-worker.ts will never appear, even in development mode, creating inconsistent debugging experience.

## Solution

Add the same debug enablement pattern to shared-worker.ts that exists in worker.ts.

## Expected Outcome

- shared-worker.ts debug logs appear in development mode
- Consistent debugging experience across all workers
- No change in production behavior (debug stays disabled)

## Considerations

- Should use the same dev mode detection pattern as worker.ts
- May be affected by specs/standardize-dev-mode-check.md if that changes the detection approach
