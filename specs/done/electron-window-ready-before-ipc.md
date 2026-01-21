# Spec: Ensure Window Ready Before Sending IPC Messages

## Problem
When a notification is clicked or other actions trigger window creation, IPC messages (like 'navigate-to') are sent immediately after createWindow(). However:

1. If mainWindow is null and createWindow() is called, the window may not be fully ready before subsequent code runs
2. Even if the window exists, webContents may not have finished loading the React app
3. IPC messages sent before the React app initializes are lost because no listeners are registered yet

This affects notification click handlers and potentially other places that send IPC after window creation.

## Desired Behavior
IPC messages should only be sent after the window's webContents has finished loading and the React app is ready to receive them. This ensures navigation events and other IPC messages are not lost.

## Considerations
- Need to handle both cases: window already exists vs newly created
- Should wait for `did-finish-load` event on newly created windows
- May want a utility function to centralize this pattern if used in multiple places
- Balance between robustness and code complexity

## Files likely involved
- `apps/electron/src/main.ts` - notification click handler, potentially other IPC senders
