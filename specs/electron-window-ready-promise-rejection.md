# Spec: Reject window ready promise on window close

## Problem

In `apps/electron/src/main.ts`, the `ensureWindowReady()` function returns a cached promise that resolves when the window's `did-finish-load` event fires. However, if the window closes while callers are awaiting this promise, they hang indefinitely because:

1. Caller gets reference to existing `windowReadyPromise`
2. Window closes, setting `windowReadyPromise = null`
3. Caller is still awaiting the old promise which never resolves

This can cause tray clicks, shortcuts, or notification clicks to hang if the window closes unexpectedly.

## Solution

Store a reject function alongside the resolve function. When the window closes, reject the pending promise before nulling the references. This allows callers to handle the rejection gracefully (e.g., by retrying).

## Expected Outcome

- Promises returned by `ensureWindowReady()` always either resolve or reject (never hang)
- Callers awaiting window ready when window closes receive a rejection they can handle
- No change to happy-path behavior

## Considerations

- Callers may need try/catch if they want to retry after rejection
- The rejection error message should be descriptive (e.g., "Window was closed")
