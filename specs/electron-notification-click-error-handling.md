# Spec: Add error handling to notification click handler

## Problem

In `apps/electron/src/main.ts`, the notification click handler is async but has no try-catch:

```typescript
notification.on('click', async () => {
  await ensureWindowReady();  // Could throw
  mainWindow?.show();
  mainWindow?.focus();
  // ...
});
```

If `ensureWindowReady()` throws, the error is silently swallowed (Node.js async event handler behavior). The user clicks the notification expecting navigation, but nothing happens with no indication of failure.

## Solution

Wrap the click handler body in try-catch and log any errors via debugMain.

## Expected Outcome

- Errors in notification click handling are logged for debugging
- Silent failures become visible in debug logs
- User experience unchanged on success, but failures are diagnosable

## Considerations

- Consider whether to show a fallback behavior on error (e.g., just open the main window without navigation)
- This pattern should apply to any async event handlers in the Electron main process
