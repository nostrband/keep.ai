# Spec: Handle showNotification return value in App.tsx

## Problem
In `apps/web/src/App.tsx`, there are 3 calls to `window.electronAPI.showNotification` (lines 73, 86, 96) that ignore the boolean return value. This is inconsistent with the pattern established in WorkflowNotifications.ts which checks the return value and handles failures.

The calls are in `handlePauseAllAutomations`:
- Line 73: "No workflows to pause" notification
- Line 86: Success notification after pausing
- Line 96: Error notification

## Solution
Check the return value from showNotification and handle failures appropriately:
- Log a warning if notification fails
- Optionally show a toast fallback for important notifications (like the success case)

## Expected Outcome
- Consistent notification handling pattern across the codebase
- Failures are logged and potentially handled with fallback
- Better debugging when notifications silently fail

## Considerations
- These are one-off notifications, not as critical as recurring WorkflowNotifications
- User already sees the result in UI (paused workflows), so notification failure is less impactful
- Could use toast as fallback if notification fails
