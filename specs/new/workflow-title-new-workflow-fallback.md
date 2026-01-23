# Spec: Change Workflow Title Fallback to "New workflow"

## Problem
When a workflow has no title, the UI displays "Workflow <id>" (e.g., "Workflow a1b2c3d4") as the fallback. This is confusing because it exposes an internal ID that has no meaning to users. A cleaner fallback would be "New workflow".

## Locations
The fallback pattern `Workflow ${workflow.id.slice(0, 8)}` appears in 6 files:

1. `apps/web/src/components/WorkflowInfoBox.tsx` line 74
2. `apps/web/src/components/WorkflowDetailPage.tsx` lines 223, 248
3. `apps/web/src/components/WorkflowEventGroup.tsx` line 69
4. `apps/web/src/components/WorkflowsPage.tsx` line 50
5. `apps/web/src/components/TaskDetailPage.tsx` line 188
6. `apps/web/src/components/MainPage.tsx` line 505

## Solution
Replace all instances of the fallback from:
```tsx
workflow.title || `Workflow ${workflow.id.slice(0, 8)}`
```
to:
```tsx
workflow.title || "New workflow"
```

## Changes
Update each of the 6 files listed above to use "New workflow" as the fallback text instead of "Workflow <id>".

## Expected Outcome
- Workflows without titles display "New workflow" instead of "Workflow <id>"
- Users see a friendly, understandable placeholder
- Internal IDs are not exposed in the UI
- Consistent fallback text across all workflow title displays
