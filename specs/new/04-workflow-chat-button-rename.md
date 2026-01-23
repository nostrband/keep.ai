# Workflow Page: Rename Chat Button to Edit

## Summary

On the workflow page, there's a "Chat" button that navigates to the agent chat for editing the workflow. Rename this button to "Edit" to better reflect its purpose.

## Current Behavior

The button is labeled "Chat" at `WorkflowDetailPage.tsx` lines 313-321:
```tsx
{workflow?.chat_id && (
  <Button
    onClick={handleChat}
    size="sm"
    variant="outline"
    className="cursor-pointer"
  >
    Chat
  </Button>
)}
```

## Root Cause

The button was named "Chat" because it navigates to a chat interface. However, the purpose of this chat is to edit/modify the workflow through conversation with the agent, so "Edit" is more descriptive of the action.

## Required Changes

### File: `apps/web/src/components/WorkflowDetailPage.tsx`

Change the button text from "Chat" to "Edit":
```tsx
{workflow?.chat_id && (
  <Button
    onClick={handleChat}
    size="sm"
    variant="outline"
    className="cursor-pointer"
  >
    Edit
  </Button>
)}
```

## Files to Modify

1. **`apps/web/src/components/WorkflowDetailPage.tsx`**
   - Line 320: Change "Chat" to "Edit"

## Testing

- [ ] Button on workflow page shows "Edit" instead of "Chat"
- [ ] Clicking "Edit" still navigates to the chat page for the workflow
- [ ] Button styling remains the same
