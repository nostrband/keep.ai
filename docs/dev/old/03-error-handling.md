# Error Handling

## Overview

When a script fails, the error is classified to determine the appropriate response. Some errors require user action, while others can be automatically fixed by AI.

## Error Classification

Errors are classified into five types based on their nature and fixability:

| Type | Description | Handler | User Notified |
|------|-------------|---------|---------------|
| `auth` | Authentication expired or invalid | User must reconnect | Yes |
| `permission` | Access denied to resource | User must grant access | Yes |
| `network` | External service unavailable | Retry, then notify user | Yes (after retries) |
| `logic` | Bug in script code | AI auto-fix | No (unless escalated) |
| `internal` | Unexpected system error | Notify user | Yes |

## Classification Logic

```typescript
// packages/agent/src/errors.ts

function classifyError(error: Error): ClassifiedError {
  const message = error.message.toLowerCase();

  // Auth errors - user must reconnect
  if (message.includes('token expired') ||
      message.includes('unauthorized') ||
      message.includes('authentication')) {
    return { type: 'auth', message: error.message };
  }

  // Permission errors - user must grant access
  if (message.includes('permission denied') ||
      message.includes('forbidden') ||
      message.includes('access denied')) {
    return { type: 'permission', message: error.message };
  }

  // Network errors - retry then notify
  if (message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection refused')) {
    return { type: 'network', message: error.message };
  }

  // Internal errors - system failures, notify user
  if (message.includes('internal') ||
      message.includes('unexpected') ||
      error.name === 'InternalError') {
    return { type: 'internal', message: error.message };
  }

  // Default to logic error - AI can try to fix
  return { type: 'logic', message: error.message };
}
```

## Error Handling Flow

```
Script execution fails
        |
        v
    Classify error
        |
        +---> auth
        |       |
        |       v
        |   Create type='error' event
        |   User notified immediately
        |
        +---> permission
        |       |
        |       v
        |   Create type='error' event
        |   User notified immediately
        |
        +---> network
        |       |
        |       v
        |   Retry with backoff (up to 3 times)
        |       |
        |       +---> Success: continue
        |       |
        |       +---> Still failing:
        |                 |
        |                 v
        |             Create type='error' event
        |             User notified
        |
        +---> logic
        |       |
        |       v
        |   Enter maintenance mode
        |   (see 04-auto-fix-mode.md)
        |
        +---> internal
                |
                v
            Create type='error' event
            User notified
```

## User-Facing Error Event

When a user needs to take action, create an error event:

```typescript
await chatStore.saveChatEvent(
  generateId(),
  task.chat_id,
  "error",
  {
    error_type: classifiedError.type,  // 'auth', 'permission', 'network', 'internal'
    message: classifiedError.message,
    script_run_id: scriptRunId,
    workflow_id: workflow.id,
    script_id: script.id,
  }
);
```

## Error UI Actions

Each error type suggests a specific action:

| Error Type | UI Action Button | What It Does |
|------------|-----------------|--------------|
| `auth` | "Reconnect {service}" | Opens OAuth flow |
| `permission` | "Check Permissions" | Opens permissions settings |
| `network` | "Retry Now" | Triggers immediate re-run |
| `internal` | "View Details" | Shows error details |

## Error Resolution

Errors can be resolved by:

1. **User action** - Reconnect service, grant permission, etc.
2. **Dismiss** - User acknowledges but doesn't fix (sets `acknowledged_at`)
3. **Successful re-run** - Next run succeeds, error state clears

## Network Error Retry Logic

```typescript
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 15000];  // 1s, 5s, 15s

async function executeWithRetry(fn: () => Promise<void>): Promise<void> {
  let lastError: Error;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (classifyError(error).type !== 'network') {
        throw error;  // Don't retry non-network errors
      }

      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  throw lastError;  // All retries exhausted
}
```

## Key Files

- `packages/agent/src/errors.ts` - Error classification
- `packages/agent/src/workflow-worker.ts` - Error handling flow
- `apps/web/src/components/workflow/WorkflowErrorAlert.tsx` - Error UI
