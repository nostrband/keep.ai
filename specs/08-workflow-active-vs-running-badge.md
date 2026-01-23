# Workflow Badges: Active vs Running

## Summary

On the homepage workflow list and workflow page:
1. An "active" workflow shows a "Running" badge - this is misleading (suggests script is executing right now)
2. Should show "Active" for active workflows
3. Should show "Running" badge only when there's actually a non-finished script_run in progress

## Current Behavior

In `StatusBadge.tsx` lines 6-20:
```tsx
export function WorkflowStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-100 text-green-800">Running</Badge>;  // Wrong!
    case "paused":
      return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
    // ...
  }
}
```

## Root Cause

The `WorkflowStatusBadge` component conflates workflow status "active" (scheduled and will run) with execution status "running" (script is currently executing).

## Required Changes

### 1. Fix WorkflowStatusBadge - Change "Running" to "Active"

**File: `apps/web/src/components/StatusBadge.tsx`**

```tsx
export function WorkflowStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-100 text-green-800">Active</Badge>;  // Fixed
    case "paused":
      return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
    // ... rest unchanged
  }
}
```

### 2. Add "Running" Badge When Script Is Actually Running

Need to show an additional "Running" badge when there's a script_run with no `end_timestamp`.

**File: `apps/web/src/components/MainPage.tsx`**

In the workflow list rendering (around line 507), add a check for running script:
```tsx
<div className="flex items-center gap-2 mb-1">
  <h3 className="font-medium text-gray-900">
    {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
  </h3>
  <WorkflowStatusBadge status={workflow.status} />
  {/* Add Running badge if script is currently executing */}
  {latestRuns[workflow.id] && !latestRuns[workflow.id].end_timestamp && (
    <Badge className="bg-blue-100 text-blue-800">Running</Badge>
  )}
</div>
```

**File: `apps/web/src/components/WorkflowDetailPage.tsx`**

Similar change around line 250:
```tsx
<WorkflowStatusBadge status={workflow.status} />
{/* Add Running badge if any script run is in progress */}
{scriptRuns.some((run: any) => !run.end_timestamp) && (
  <Badge className="bg-blue-100 text-blue-800">Running</Badge>
)}
```

## Files to Modify

1. **`apps/web/src/components/StatusBadge.tsx`**
   - Change "Running" to "Active" for status === "active"

2. **`apps/web/src/components/MainPage.tsx`**
   - Add conditional "Running" badge when latestRun has no end_timestamp

3. **`apps/web/src/components/WorkflowDetailPage.tsx`**
   - Add conditional "Running" badge when any scriptRun has no end_timestamp

## Testing

- [ ] Active workflow shows "Active" badge (green)
- [ ] When script is currently running, shows both "Active" and "Running" badges
- [ ] When script finishes, "Running" badge disappears
- [ ] Paused workflows still show "Paused" badge
- [ ] Ready workflows still show "Ready" badge
- [ ] Draft workflows still show "Draft" badge
