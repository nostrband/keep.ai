# Homepage: Show Schedule in Workflow List

## Summary

The workflow list on the homepage only shows "Next run in ..." as secondary text. It should also show the schedule (human-readable cron description) if the workflow has a `cron` field set.

## Current Behavior

In `MainPage.tsx`, the `getSecondaryLine()` function (lines 50-116) computes secondary text that includes:
- "Waiting for your input"
- "Auto-fixing issue..."
- Error messages with time ago
- "Last run: X ago"
- "Running now..."
- "Next run: in Xh"
- "Not scheduled"

The schedule itself (e.g., "Daily at 9am") is not shown.

## Root Cause

The secondary line logic focuses on run status and next run time, but doesn't include the underlying schedule pattern. Users can't see at a glance what the schedule is.

## Required Changes

### File: `apps/web/src/components/MainPage.tsx`

1. Import `formatCronSchedule` from WorkflowInfoBox:
```typescript
import { formatCronSchedule } from "./WorkflowInfoBox";
```

2. Modify the workflow list rendering to show schedule. In the workflow card around lines 501-516, add schedule display:

```tsx
<div className="flex items-start justify-between">
  <div className="flex-1">
    <div className="flex items-center gap-2 mb-1">
      <h3 className="font-medium text-gray-900">
        {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
      </h3>
      <WorkflowStatusBadge status={workflow.status} />
    </div>
    {/* Show schedule if cron is set */}
    {workflow.cron && (
      <div className="text-sm text-gray-500 mb-1">
        Schedule: {formatCronSchedule(workflow.cron)}
      </div>
    )}
    <div className={`text-sm ${
      workflow.needsAttention ? "text-red-600" : "text-gray-500"
    }`}>
      {workflow.secondaryText}
    </div>
  </div>
</div>
```

Alternatively, combine into a single line:
```tsx
<div className={`text-sm ${
  workflow.needsAttention ? "text-red-600" : "text-gray-500"
}`}>
  {workflow.cron && (
    <span className="text-gray-400">{formatCronSchedule(workflow.cron)} · </span>
  )}
  {workflow.secondaryText}
</div>
```

## Files to Modify

1. **`apps/web/src/components/WorkflowInfoBox.tsx`**
   - Export `formatCronSchedule` function (if not already exported per spec #07)

2. **`apps/web/src/components/MainPage.tsx`**
   - Import `formatCronSchedule`
   - Add schedule display to workflow list items

## Testing

- [ ] Workflows with cron show "Schedule: Daily at 9:00 AM" or similar
- [ ] Workflows without cron don't show schedule line
- [ ] Secondary text (Next run, Last run, etc.) still displays correctly
- [ ] Schedule is readable and doesn't clutter the UI
- [ ] Complex cron expressions fall back gracefully
