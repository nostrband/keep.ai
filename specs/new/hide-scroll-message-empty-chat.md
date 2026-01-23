# Spec: Hide "Scroll to see more messages" When Chat is Empty

## Problem
After submitting text for a new workflow on the homepage and navigating to the chat page, "Scroll up to load older messages" text appears at the top even though there are no messages yet. This is confusing for users starting a new conversation.

## Root Cause
The condition to show the scroll message only checks `hasNextPage` but doesn't verify that there are actual messages displayed. When a new chat is created, `hasNextPage` might be true even with zero messages.

## Location
`apps/web/src/components/ChatInterface.tsx` lines 306-312

The problematic code:
```tsx
{hasNextPage && (
  <div className="py-4 text-center text-gray-500">
    {isFetching
      ? "Loading older messages..."
      : "Scroll up to load older messages"}
  </div>
)}
```

## Solution
Add a check for `rows.length > 0` to ensure the message only appears when there are already messages displayed.

## Changes
```tsx
{hasNextPage && rows.length > 0 && (
  <div className="py-4 text-center text-gray-500">
    {isFetching
      ? "Loading older messages..."
      : "Scroll up to load older messages"}
  </div>
)}
```

## Expected Outcome
- New chats don't show the "Scroll up to load older messages" text
- The text appears only when there are existing messages and more available to load
- Better user experience when starting new conversations
