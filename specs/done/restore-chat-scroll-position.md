# Spec: Restore scroll position when returning to chat pages

## Problem

When navigating away from a chat page (e.g., clicking on a chat element to view task details) and then clicking "back", the scroll position is not restored. User loses their place in the conversation and has to scroll to find where they were.

## Solution

Save and restore scroll position for ChatInterface pages when navigating back via browser history.

## Expected Outcome

- User scrolls to position X in a chat
- User clicks on an element that navigates to another page (e.g., task detail)
- User clicks browser back button
- Scroll position is restored to position X

## Considerations

- Need to persist scroll position per chat ID
- Should work with both browser back button and in-app back navigation
- Consider using sessionStorage, React Router state, or a scroll restoration library
- May need to coordinate with pin-to-bottom logic (don't pin if restoring position)
- Handle edge case where chat content changed while away
