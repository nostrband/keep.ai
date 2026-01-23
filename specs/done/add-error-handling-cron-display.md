# Spec: Add error handling for cron schedule display

## Problem
In `apps/web/src/components/MainPage.tsx:521-523`:
```tsx
{workflow.cron && (<span>{formatCronSchedule(workflow.cron)} · </span>)}
```

If `formatCronSchedule` throws an exception (malformed cron, unexpected input), the entire workflow list item breaks and React may unmount the component tree.

## Solution
Add error handling either:

**Option A: In the component (defensive rendering)**
```tsx
{workflow.cron && (
  <span>
    {(() => {
      try {
        return formatCronSchedule(workflow.cron);
      } catch {
        return workflow.cron; // Fallback to raw cron
      }
    })()} ·
  </span>
)}
```

**Option B: In formatCronSchedule itself (recommended)**
Make the function never throw - always return a string (raw cron on error):
```typescript
export function formatCronSchedule(cron: string): string {
  try {
    // ... parsing logic
  } catch {
    return cron; // Return raw cron on any error
  }
}
```

## Expected Outcome
- Malformed cron expressions don't crash the UI
- Workflow list remains functional even with bad data
- Users see raw cron string as fallback instead of broken UI

## Considerations
- Option B (error handling in function) is cleaner and protects all callers
- Combines well with the NaN validation spec
- Could log errors for debugging without crashing
