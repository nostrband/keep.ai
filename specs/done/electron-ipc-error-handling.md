# Spec: Add consistent error handling to all Electron IPC handlers

## Problem

In `apps/electron/src/main.ts`, the `showNotification` handler has try-catch error handling, but other IPC handlers lack similar protection:

- `open-external`: shell.openExternal() can throw if URL is invalid or system cannot handle it
- `update-tray-badge`: tray.setTitle() and setToolTip() could fail

If these handlers throw, IPC communication fails and the error propagates to the renderer, potentially causing UI issues.

## Solution

Apply consistent error handling pattern across all IPC handlers:
- Wrap handler bodies in try-catch
- Log errors via debugMain for production debugging
- Return appropriate success/failure indicators
- Ensure renderer code handles failure cases gracefully

## Expected Outcome

- All IPC handlers are resilient to failures
- Errors are logged for debugging
- Renderer code receives clean success/failure responses
- No unhandled exceptions in IPC communication

## Considerations

- Each handler may need different return types (boolean, void, data objects)
- Some handlers may need to distinguish between different failure types
- Document which handlers can fail and what callers should do
