# Integration Topic 6: Session Lifecycle

> Depends on: Topic 2 (handler run status), Topic 4 (commit operations)

## Summary

Simplify session lifecycle. After Topic 2, session finalization is already atomic
inside `updateHandlerRunStatus()`. This topic removes the now-dead session
finalization functions and updates the session creation and `SessionResult` flow.

## Current State

After Topic 2 is implemented, the following session finalization functions in
`session-orchestration.ts` become dead code because `updateHandlerRunStatus()`
handles session finalization atomically:

- `failSession()` — was: finish session + set workflow.status="error"
- `finishSessionForMaintenance()` — was: finish session only
- `finishSessionForTransient()` — was: finish session only
- `suspendSession()` — was: finish session + set workflow.status="paused"
- `handleApprovalNeeded()` — was: failSession + create notification

`completeSession()` is **NOT dead** — it's the success-path session finalization
called when the consumer loop finishes. This maps to `ExecutionModelManager.finishSession()`.

### SessionResult flow

Currently: `executeHandler()` → `HandlerResult` → session-orchestration checks
status → calls finalization function → returns `SessionResult`.

After Topic 2: `executeHandler()` → `HandlerResult` → session-orchestration
just maps to `SessionResult` (finalization already done).

### Notification creation

`handleApprovalNeeded()` creates an "error" notification for auth/permission
errors. This notification creation is NOT part of EMM — it's a UI concern.
It should be moved to the scheduler's `postSessionResult()` method.

## Changes Required

### 1. Remove dead session finalization functions

Delete from `session-orchestration.ts`:
- `failSession()` (lines 89-114)
- `finishSessionForMaintenance()` (lines 121-144)
- `finishSessionForTransient()` (lines 151-171)
- `suspendSession()` (lines 178-202)

### 2. Replace `completeSession()` with EMM

```typescript
// BEFORE:
await completeSession(api, session);

// AFTER:
await context.emm.finishSession(session.id);
```

Delete `completeSession()` function.

### 3. Simplify result handling in `executeWorkflowSession()`

```typescript
// BEFORE (producer loop):
if (result.status === "failed:logic") {
  await finishSessionForMaintenance(api, session, errorMsg, errType);
  return { status: "maintenance", ... };
}
if (isFailedStatus(result.status)) {
  await failSession(api, session, errorMsg, errType);
  return { status: "failed", ... };
}
// ... etc for each status

// AFTER (producer loop):
if (result.status === "failed:logic") {
  return { status: "maintenance", error: errorMsg, ... };
}
if (isFailedStatus(result.status)) {
  return { status: "failed", error: errorMsg, ... };
}
// ... etc — no DB calls, just map status to SessionResult
```

Same simplification applies to:
- Consumer loop in `executeWorkflowSession()`
- `continueSession()`
- `retryWorkflowSession()`

### 4. Move notification creation to scheduler

`handleApprovalNeeded()` creates a notification. Move this to
`workflow-scheduler.ts`'s `postSessionResult()`:

```typescript
// In postSessionResult(), after checking result.status:
if (result.status === 'failed' && result.errorType === 'auth') {
  // Create auth notification (was in handleApprovalNeeded)
  try {
    await this.api.notificationStore.saveNotification({
      id: crypto.randomUUID(),
      workflow_id: workflow.id,
      type: "error",
      payload: JSON.stringify({
        error_type: result.errorType,
        message: result.error,
      }),
      timestamp: new Date().toISOString(),
      // ...
    });
  } catch { /* best-effort */ }
}
```

Delete `handleApprovalNeeded()` from `session-orchestration.ts`.

### 5. Simplify error catch blocks

The try/catch blocks at the end of `executeWorkflowSession()` and
`retryWorkflowSession()` currently call `failSession()`. These should now
just return the SessionResult — but note that errors at this level are
**outside handler execution** (e.g. config parse error, workflow not found).

For these non-handler errors, there's no handler run, so EMM wasn't called.
We still need to finalize the session:

```typescript
// AFTER:
catch (error) {
  const { status: runStatus, error: classifiedError } = getRunStatusForError(error, "session");
  // Finalize session directly (no handler run involved)
  await context.emm.finishSession(session.id);
  // OR: Manual session close since there's no handler run:
  // The session was created but no handler ran. Just close it.
  await api.scriptStore.finishScriptRun(session.id, ..., "failed", ...);
  return { status: "failed", error: classifiedError.message, sessionId };
}
```

This is a corner case — errors outside handler execution are rare.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/session-orchestration.ts` | Remove dead functions, simplify result handling, replace completeSession |
| `packages/agent/src/workflow-scheduler.ts` | Move notification creation to postSessionResult |

## Verification

- Sessions are finalized atomically by EMM for handler failures
- Success-path sessions finalized by EMM.finishSession()
- Auth notifications still created (moved to scheduler)
- Session catch blocks handle non-handler errors gracefully
- `turbo run build` passes
