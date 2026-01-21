# Spec: Add ensureWindowReady() to pause-all tray menu handler

## Problem

The "Pause all automations" tray menu handler sends an IPC message without first ensuring the window is ready. Unlike the "New automation..." handler which calls `ensureWindowReady()`, the pause-all handler directly sends the IPC message if `mainWindow` exists.

If the user clicks "Pause all automations" before the window has finished loading, the IPC message is lost and no workflows are paused.

## Solution

Add `await ensureWindowReady()` call to the pause-all tray menu handler before sending the IPC message, matching the pattern used by other handlers like "New automation...".

## Expected Outcome

- Clicking "Pause all automations" during cold start waits for window to be ready
- IPC message is reliably delivered after window initialization
- Consistent behavior with other tray menu handlers

## Considerations

- This is a rare edge case (cold start + immediate tray menu interaction)
- The fix is a one-line addition for consistency
- Consider whether pause-all should work without a window at all (direct DB update from main process)
