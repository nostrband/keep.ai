# Spec: Remove Task Row from Workflow Detail Page

## Problem
The workflow detail page displays a "Task" section showing the underlying task associated with the workflow. This is an implementation detail that exposes internal architecture to users and adds unnecessary complexity to the UI.

## Location
`apps/web/src/components/WorkflowDetailPage.tsx` lines 406-428

The problematic code:
```tsx
{/* Task Section */}
{task && (
  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
    <h2 className="text-lg font-semibold text-gray-900 mb-4">Task</h2>
    <Link to={`/tasks/${task.id}`} ...>
      ...
    </Link>
  </div>
)}
```

## Solution
Remove the entire Task Section block (lines 406-428) from WorkflowDetailPage.tsx. Also remove the unused `useTask` hook import and call if no longer needed elsewhere in the component.

## Changes
1. Delete the Task Section JSX block (lines 406-428)
2. Remove `const { data: task } = useTask(workflow?.task_id || "");` (line 29) if task is not used elsewhere
3. Remove `useTask` from imports if no longer needed

## Expected Outcome
- Workflow detail page no longer shows the "Task" section
- Users see only workflow-relevant information
- Internal implementation details are hidden from users
