# Spec: Complete StatusBadge component consolidation

## Problem

The StatusBadge extraction (commit 89e9794) is approximately 84% complete. Remaining duplicate badge logic exists:

1. TaskDetailPage.tsx has inline WorkflowStatusBadge logic instead of using the component
2. No ScriptRunStatusBadge component exists - 3 files have duplicate inline logic (WorkflowDetailPage, ScriptDetailPage, ScriptRunDetailPage)
3. TaskDetailPage.tsx has inconsistent task run badge logic in the runs list

## Solution

1. Replace inline workflow status badge in TaskDetailPage with WorkflowStatusBadge component
2. Create ScriptRunStatusBadge component and update the 3 files that display script run status
3. Replace inline task run badge in TaskDetailPage with TaskRunStatusBadge component

## Expected Outcome

- All status badge rendering uses shared StatusBadge components
- No inline badge ternary logic remains in page components
- Consistent labeling across similar badge types
