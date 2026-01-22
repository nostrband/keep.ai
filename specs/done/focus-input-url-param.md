# Spec: Use URL param for focus-input instead of custom events

## Problem

In `apps/web/src/App.tsx` and `apps/web/src/components/MainPage.tsx`, the focus-input IPC handler uses a custom event with a hardcoded 100ms delay to wait for navigation to complete. This is brittle:

- If rendering takes longer than 100ms, the textarea doesn't exist yet and focus silently fails
- If rendering is faster, there's unnecessary delay
- Uses DOM queries (`querySelector`) which is fragile and not React-idiomatic

## Solution

Replace the custom event approach with URL query parameter signaling:

1. IPC handler navigates to `/?focus=input` instead of dispatching custom events
2. MainPage reads the query param on mount
3. If `focus=input` is present, focus the textarea and clear the param from URL

This eliminates race conditions because the component reads the param when it mounts - the focus happens naturally in the component's lifecycle.

## Expected Outcome

- "New automation..." tray menu item reliably focuses the input field
- No timing-dependent code (setTimeout, retries)
- Works across page refreshes (if user refreshes with param in URL)
- Removes custom event and DOM query code

## Considerations

- Clear the param after focusing to prevent re-focusing on subsequent renders
- Use `navigate('/', { replace: true })` to avoid polluting browser history
- Remove the `FOCUS_INPUT_EVENT` constant and related listener code
