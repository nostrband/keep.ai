# Workflow Page: Human-Readable Cron Schedule

## Summary

On the workflow page, the schedule is shown as a raw cron expression (e.g., "0 9 * * *"). It should be displayed as a human-readable string (e.g., "Daily at 9:00 AM").

## Current Behavior

In `WorkflowDetailPage.tsx` lines 357-366:
```tsx
{workflow.cron && (
  <div>
    <h3 className="text-sm font-medium text-gray-700 mb-2">Schedule</h3>
    <p className="text-gray-900">{workflow.cron}</p>  {/* Shows raw cron */}
    {nextRunTime && (
      <p className="text-sm text-gray-600 mt-1">
        Next run at: {nextRunTime.toLocaleString()}
      </p>
    )}
  </div>
)}
```

## Root Cause

The workflow page displays `workflow.cron` directly without formatting.

However, `WorkflowInfoBox.tsx` already has a `formatCronSchedule()` function (lines 12-57) that converts cron expressions to human-readable strings like:
- "Every minute"
- "Every hour at :30"
- "Every day at 9:00 AM"
- "Every Monday at 2:30 PM"

This function should be reused on the workflow detail page.

## Required Changes

### Option A: Extract and Share the Function

1. Move `formatCronSchedule` to a shared utility file
2. Import and use it in both `WorkflowInfoBox.tsx` and `WorkflowDetailPage.tsx`

### Option B: Import from WorkflowInfoBox (Quick Fix)

Export the function from `WorkflowInfoBox.tsx` and import it in `WorkflowDetailPage.tsx`.

### File: `apps/web/src/components/WorkflowInfoBox.tsx`

Export the function:
```typescript
export function formatCronSchedule(cron?: string): string {
  // existing implementation
}
```

### File: `apps/web/src/components/WorkflowDetailPage.tsx`

1. Import the function:
   ```typescript
   import { WorkflowInfoBox, formatCronSchedule } from "./WorkflowInfoBox";
   ```

   Or if WorkflowInfoBox is not a default export:
   ```typescript
   import { formatCronSchedule } from "./WorkflowInfoBox";
   ```

2. Use it in the schedule display (around line 360):
   ```tsx
   {workflow.cron && (
     <div>
       <h3 className="text-sm font-medium text-gray-700 mb-2">Schedule</h3>
       <p className="text-gray-900">{formatCronSchedule(workflow.cron)}</p>
       {nextRunTime && (
         <p className="text-sm text-gray-600 mt-1">
           Next run at: {nextRunTime.toLocaleString()}
         </p>
       )}
     </div>
   )}
   ```

## Files to Modify

1. **`apps/web/src/components/WorkflowInfoBox.tsx`**
   - Add `export` to `formatCronSchedule` function

2. **`apps/web/src/components/WorkflowDetailPage.tsx`**
   - Import `formatCronSchedule`
   - Use it to format `workflow.cron` display

## Testing

- [ ] Schedule shows "Daily at 9:00 AM" instead of "0 9 * * *"
- [ ] Schedule shows "Every Monday at 2:30 PM" instead of "30 14 * * 1"
- [ ] Schedule shows "Every minute" instead of "* * * * *"
- [ ] Complex/unsupported patterns fall back to showing raw cron
- [ ] WorkflowInfoBox still works correctly
