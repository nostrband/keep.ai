# Spec: Fix showNotification return type and handle failures

## Problem

In `apps/electron/src/main.ts`, the `showNotification` IPC handler now returns `Promise<boolean>` (true on success, false on failure), but the TypeScript type definition in `vite-env.d.ts` still declares it as `Promise<void>`.

This means:
- Callers cannot type-safely check the return value
- TypeScript won't warn if the return value is ignored
- The caller in WorkflowNotifications.ts marks workflows as "notified" even when the notification failed

## Solution

1. Update the type definition in `apps/electron/src/vite-env.d.ts` to return `Promise<boolean>`
2. Update `apps/web/src/lib/WorkflowNotifications.ts` to check the return value and only mark as notified on success

## Expected Outcome

- Type definition matches actual implementation
- Failed notifications are not marked as "notified" in the set
- On next notification check, the system will retry showing the notification
- Debug logging when notification creation fails

## Considerations

- If notification consistently fails, it will retry every check cycle - may want to limit retries or add backoff in the future
