# Spec: Extract isRunning calculation to shared hook

## Problem
The `isRunning` business logic in `apps/web/src/components/MainPage.tsx:216`:
```typescript
const isRunning = latestRun && !latestRun.end_timestamp;
```

This logic exists only in MainPage. WorkflowDetailPage doesn't show a "Running" badge at all, creating UI inconsistency between the workflow list and detail views.

## Solution
Extract the running state calculation to a shared utility or hook:

1. Create `apps/web/src/hooks/useWorkflowRunningState.ts` or utility function
2. Implement consistent logic for determining if a workflow is running
3. Use in both MainPage and WorkflowDetailPage
4. Ensure "Running" badge displays consistently across the app

## Expected Outcome
- Consistent "Running" indicator across all workflow views
- Single source of truth for running state logic
- Easier to maintain if the logic needs to change

## Considerations
- Decide if this should be a hook (if it needs data fetching) or a pure utility function
- May need to fetch latestRun data in WorkflowDetailPage if not already available
- Consider edge cases (null run, missing end_timestamp, etc.)
