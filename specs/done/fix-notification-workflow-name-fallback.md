# Spec: Fix Notification Workflow Name Fallback

## Problem
In WorkflowNotifications.ts, when building workflow names for grouped notification bodies, the fallback text uses "Untitled" for workflows without titles. This is inconsistent with the rest of the codebase which uses "New workflow" as the fallback.

Current code:
```typescript
w.workflow.title || 'Untitled'
```

## Solution
Change the fallback from "Untitled" to "New workflow" to match the pattern used elsewhere in the codebase.

## Expected Outcome
- Notification body shows "New workflow" instead of "Untitled" for workflows without titles
- Consistent fallback text across the application

## Considerations
- File: `apps/web/src/lib/WorkflowNotifications.ts`
- This is related to the broader workflow title fallback centralization (specs/new/centralize-workflow-title-fallback.md)
