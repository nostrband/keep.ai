# Spec: Clear success message when showing warning in WorkflowDetailPage

## Problem

WorkflowDetailPage's `showWarning()` function doesn't clear the success message when displaying a warning. This means both messages could briefly appear together. Other components (ScriptDetailPage, TaskDetailPage) properly clear the success message when showing a warning.

## Solution

Add `setSuccessMessage("")` to WorkflowDetailPage's showWarning() function to match the pattern used in other components.

## Expected Outcome

- Only one message type (success or warning) is visible at a time
- Consistent behavior across all detail pages
