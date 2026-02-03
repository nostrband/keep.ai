# Spec: Replace window.confirm() with Modal Dialog

## Problem

WorkflowDetailPage.tsx uses native `window.confirm()` for the archive confirmation:

```typescript
if (!window.confirm("Archive this workflow?...")) {
  return;
}
```

Issues with this approach:
1. Blocks the event loop - freezes the entire app
2. Can't match the app's design system - looks out of place
3. Accessibility issues - screen readers don't handle native confirms well
4. No undo option - binary yes/no only

## Solution

Replace `window.confirm()` with a purpose-built confirmation modal dialog using the app's existing UI components (Button, Dialog, etc.).

## Expected Outcome

- Confirmation dialog matches the app's design system
- Non-blocking - doesn't freeze the UI
- Accessible to screen readers
- Consistent UX with other confirmations in the app

## Considerations

- Check if the codebase already has a reusable confirmation dialog component
- If not, consider creating a generic ConfirmDialog component that can be reused elsewhere
- The dialog should clearly explain what archiving means (workflow will be moved to archive, can be restored later)
