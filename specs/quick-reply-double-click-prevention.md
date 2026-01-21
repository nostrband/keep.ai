# Spec: Prevent double-click on quick-reply buttons

## Problem

Quick-reply buttons in ChatPage rely on `addMessage.isPending` for their disabled state. There's a brief window between when the user clicks and when the mutation's `isPending` state updates, during which a fast double-click could register twice and send duplicate messages.

## Solution

Add a local disabled state that is set immediately on click, before the mutation starts. This eliminates the race condition window:

- Set local `isSubmitting` state to true synchronously on click
- Include this state in the disabled condition
- Reset the state in the mutation's `onSettled` callback

## Expected Outcome

- Double-clicking a quick-reply button only sends one message
- Button becomes disabled immediately on first click
- No duplicate messages in the chat

## Considerations

- Same pattern should be applied to other submit buttons if they have similar race conditions
- Could alternatively use a ref-based approach to avoid re-renders
- Consider debouncing as an alternative or complementary solution
