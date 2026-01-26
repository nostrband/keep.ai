# Spec: Add Archive Confirmation Dialog

## Problem

Clicking the archive button immediately archives the workflow and navigates away with no confirmation prompt. While the action is reversible (user can restore from /archived), an accidental click results in unexpected navigation and requires extra steps to undo.

## Solution

Add a simple confirmation before archiving. Options:

1. **Simple confirm()**: Quick to implement, native browser dialog
2. **Custom modal**: More polished, matches app styling

Recommended: Start with simple `confirm()` for consistency with other destructive actions.

Message: "Archive this workflow? You can restore it later from the Archived page."

## Expected Outcome

- User sees confirmation prompt before workflow is archived
- Accidental clicks don't result in immediate archiving
- Cancel returns user to workflow detail page unchanged

## Considerations

- File: `apps/web/src/components/WorkflowDetailPage.tsx`
- Keep it simple - this is a reversible action, not a deletion
- If app has an existing confirmation dialog pattern, use that for consistency
