# Spec: Fix ArchivedPage Restore Feedback

## Problem

The `handleRestore` function in ArchivedPage has two UX issues:

1. **No error feedback**: Errors are only logged to console. If restore fails, user won't know and may think it succeeded.

2. **No success feedback**: Unlike WorkflowDetailPage.handleRestore which shows "Workflow restored", ArchivedPage shows no confirmation message on success.

This creates inconsistent UX between the two restore locations.

## Solution

Add useAutoHidingMessage hook (same pattern as WorkflowDetailPage) to provide user feedback for both success and error cases.

## Expected Outcome

- Users see "Workflow restored" message on successful restore
- Users see error message if restore fails
- Consistent UX between ArchivedPage and WorkflowDetailPage

## Considerations

- File: `apps/web/src/components/ArchivedPage.tsx`
- Use same useAutoHidingMessage pattern as WorkflowDetailPage
- Also remove unused imports (Trash2, useNavigate) while editing this file
