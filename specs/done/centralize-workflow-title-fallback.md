# Spec: Centralize workflow title fallback

## Problem
The same fallback logic `{workflow.title || "New workflow"}` is duplicated in 6 locations:
- MainPage.tsx:511
- WorkflowDetailPage.tsx:222,247
- WorkflowInfoBox.tsx:74
- WorkflowsPage.tsx:50
- TaskDetailPage.tsx:188

This violates DRY. If the fallback text needs to change, it must be updated in 6 places.

## Solution
Create a utility function to get workflow display title:

```typescript
// apps/web/src/lib/workflowUtils.ts
export function getWorkflowTitle(workflow: { title?: string }): string {
  return workflow.title || "New workflow";
}
```

Update all 6 locations to use this function.

## Expected Outcome
- Single source of truth for workflow title fallback
- Easy to change fallback text in one place
- Consistent display across the app

## Considerations
- Could also be a constant if only the fallback string matters: `export const DEFAULT_WORKFLOW_TITLE = "New workflow"`
- Consider if other workflow display utilities should be grouped together
