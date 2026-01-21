# Spec: Add React Router ScrollRestoration for proper scroll behavior

## Problem

Two scroll-related issues exist:

1. **Back navigation doesn't restore scroll position**: When user scrolls partway through a chat, navigates away, then uses browser back button, the page scrolls to bottom instead of restoring the previous position. The current useEffect cleanup approach doesn't work reliably for full page navigations.

2. **New page navigation doesn't scroll to top**: When clicking an event item in chat (e.g., navigating to /tasks/{id}), the scroll position is inherited from the previous page instead of starting at the top.

Both are common SPA issues caused by client-side routing not triggering browser's native scroll behavior.

Additionally, there's dead code in ChatInterface.tsx: `handleBeforeUnload` function is defined but never attached to any event listener.

## Solution

Add React Router's `<ScrollRestoration />` component to the router setup. This component (available in react-router-dom v6.4+, we're on v7.9.4) handles:

- Saving scroll position per route automatically
- Restoring scroll position on back/forward navigation
- Scrolling to top on new (forward) navigation

This replaces the manual sessionStorage-based scroll saving in ChatInterface.tsx. Remove the dead `handleBeforeUnload` code.

## Expected Outcome

- Browser back/forward navigation restores exact scroll position
- Navigating to new pages (clicking links) scrolls to top
- Consistent scroll behavior matching user expectations from traditional websites
- Remove the manual scroll position save/restore code from ChatInterface.tsx
- Remove dead handleBeforeUnload function

## Considerations

- ScrollRestoration should be placed inside the Router component
- May need to configure behavior for specific routes if some should not scroll to top
- The existing "pin to bottom" behavior for new messages in chat should still work (that's separate from route-based scroll restoration)
