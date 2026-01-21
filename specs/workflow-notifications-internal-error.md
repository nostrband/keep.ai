# Spec: Add 'internal' error type to workflow notifications

## Problem

In `apps/web/src/lib/WorkflowNotifications.ts`, the notification constants don't include the 'internal' error type:

```typescript
const NOTIFY_ERROR_TYPES = ['auth', 'permission', 'network'];  // 'internal' missing
const SILENT_ERROR_TYPES = ['logic'];
```

When a workflow fails with an internal error (bugs in our code like ERROR_BAD_REQUEST), no OS notification is triggered. Users only see the error if they happen to open the app.

## Solution

1. Add 'internal' to NOTIFY_ERROR_TYPES
2. Add a notification message body case for internal errors (e.g., "Something went wrong. Please contact support.")

## Expected Outcome

- Internal errors trigger OS notifications like other notify-worthy error types
- Users are alerted to internal errors even when the app is in the background
- Notification message clearly indicates this is a system issue, not user error

## Considerations

- Message should match the MainPage.tsx message for consistency
- Internal errors are rare (indicate bugs in our code) but important to surface
