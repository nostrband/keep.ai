# Integration Topic 2: Handler Run Status Handling

> Depends on: Topic 1 (DB schema)

## Summary

Replace scattered `failRun()`, `pauseRun()`, `suspendRun()`, `pauseRunForIndeterminate()`
in `handler-state-machine.ts` with calls to `ExecutionModelManager.updateHandlerRunStatus()`.

This is the highest-impact change: it consolidates handler run status, event disposition,
session finalization, maintenance flag, and workflow.error into atomic transactions.

## Current State

### `handler-state-machine.ts` — Status update functions

**`failRun()` (lines 403-424):**
- Sets `status`, `error`, `error_type`, `end_timestamp` via bare `handlerRunStore.update()`
- Extracts serviceId/accountId from AuthError into context
- Does NOT: release events, finalize session, set maintenance flag, set workflow.error
- These are all done later by `session-orchestration.ts` based on SessionResult

**`pauseRun()` (lines 431-443):**
- Sets `status`, `error`, `end_timestamp` via bare `handlerRunStore.update()`
- Same problem: no atomic event/session/workflow handling

**`suspendRun()` (lines 451-457):**
- Delegates to `pauseRun()` with `paused:reconciliation`
- Deprecated

**`pauseRunForIndeterminate()` (lines 467-488):**
- Uses a transaction for: handler update + workflow.pending_retry_run_id + workflow.status="paused"
- Better than failRun/pauseRun but still sets workflow.status (should be user-controlled)

### Callers of these functions

All in `handler-state-machine.ts`:
1. `failRun(api, run, classifiedError, context)` — called from:
   - Producer executing phase error (lines 949, 963)
   - Consumer preparing phase error (lines 1051, 1058, 1078)
   - Consumer mutating phase error — no mutation record case (lines 1388, 1430)
   - Consumer mutating phase — mutation status=failed (line 1153)
   - Consumer emitting phase error (lines 1250, 1265)
   - State machine catch block (line 1516)

2. `pauseRun()` — called from:
   - Consumer mutating phase — needs_reconcile (line 1137)
   - Consumer mutating phase — needs_reconcile status (line 1148)

3. `pauseRunForIndeterminate()` — called from:
   - Consumer mutating phase — indeterminate outcome (line 1140)
   - Consumer mutating phase — indeterminate status (line 1151)

### session-orchestration.ts — Post-status handling

After `executeHandler()` returns a `HandlerResult`, session-orchestration does:
- `failSession()` → finishes session + sets workflow.status="error"
- `finishSessionForMaintenance()` → finishes session only (no workflow status)
- `finishSessionForTransient()` → finishes session only (no workflow status)
- `suspendSession()` → finishes session + sets workflow.status="paused"
- `handleApprovalNeeded()` → failSession + creates notification

These are the Bug 1/Bug 2 crash windows: status update and session/workflow are non-atomic.

## New Behavior

`updateHandlerRunStatus()` atomically handles ALL of:
1. Handler run status/error/end_timestamp
2. Event disposition (release or set pending_retry)
3. Session finalization
4. Maintenance flag
5. Workflow.error

### What `failRun()` becomes

```typescript
// BEFORE (bare write, non-atomic):
await failRun(api, run, classifiedError, context);
// ... then session-orchestration separately does session/workflow work

// AFTER (atomic via EMM):
const status = errorTypeToRunStatus(classifiedError.type);
const errorType = errorTypeToHandlerErrorType(classifiedError.type);
await emm.updateHandlerRunStatus(run.id, status, {
  error: classifiedError.message,
  errorType: errorType,
});
// Extract serviceId/accountId into context (same as before)
if (context && classifiedError instanceof AuthError) {
  context.errorServiceId = classifiedError.serviceId;
  context.errorAccountId = classifiedError.accountId;
}
```

### What session-orchestration becomes

`executeHandler()` still returns `HandlerResult`. But now the handler run's side
effects (events, session, maintenance, workflow.error) are already done atomically
inside `updateHandlerRunStatus()`.

Session-orchestration only needs to:
1. Check the status to decide what to return as `SessionResult`
2. **NOT** call `failSession/suspendSession/finishSessionForMaintenance/finishSessionForTransient`
   — those are now handled atomically by EMM

The session finalization functions become **dead code** and can be removed.

## Changes Required

### 1. Add `emm` (ExecutionModelManager) to `HandlerExecutionContext`

```typescript
// handler-state-machine.ts
export interface HandlerExecutionContext {
  api: KeepDbApi;
  emm: ExecutionModelManager;  // NEW
  connectionManager?: ConnectionManager;
  // ... rest unchanged
}
```

### 2. Replace `failRun()` calls

Every call to `failRun(api, run, error, context)` becomes:
```typescript
const status = errorTypeToRunStatus(error.type);
await context.emm.updateHandlerRunStatus(run.id, status, {
  error: error.message,
  errorType: errorTypeToHandlerErrorType(error.type),
});
if (context && error instanceof AuthError) {
  context.errorServiceId = error.serviceId;
  context.errorAccountId = error.accountId;
}
```

Consider extracting this as a helper: `failRunViaEMM(context, run, error)`.

### 3. Replace `pauseRun()` calls

```typescript
// BEFORE:
await pauseRun(api, run, "paused:reconciliation", "needs_reconcile");

// AFTER:
await context.emm.updateHandlerRunStatus(run.id, "paused:reconciliation", {
  error: "needs_reconcile",
});
```

### 4. Replace `pauseRunForIndeterminate()` calls

```typescript
// BEFORE (its own mini-transaction):
await pauseRunForIndeterminate(api, run, "indeterminate_mutation");

// AFTER (handled by EMM's indeterminate path):
await context.emm.updateHandlerRunStatus(run.id, "paused:reconciliation", {
  error: "indeterminate_mutation",
});
// EMM internally: sees phase=mutating + mutation_outcome="" → sets pending_retry + workflow.error
```

### 5. Remove dead session finalization functions

After this change, the following in `session-orchestration.ts` are dead code:
- `failSession()` (lines 89-114)
- `finishSessionForMaintenance()` (lines 121-144)
- `finishSessionForTransient()` (lines 151-171)
- `suspendSession()` (lines 178-202)

They are replaced by `_finalizeSession()` inside EMM's `updateHandlerRunStatus()`.

### 6. Simplify session-orchestration result handling

The big `if/else` blocks after `executeHandler()` (in `executeWorkflowSession`,
`continueSession`, `retryWorkflowSession`) change from:

```typescript
// BEFORE:
if (result.status === "failed:logic") {
  await finishSessionForMaintenance(api, session, errorMsg, errType);
  return { status: "maintenance", ... };
}
if (isFailedStatus(result.status)) {
  await failSession(api, session, errorMsg, errType);
  return { status: "failed", ... };
}
if (result.status === "paused:transient") {
  await finishSessionForTransient(api, session, ...);
  return { status: "transient", ... };
}
// etc.
```

To:
```typescript
// AFTER:
// Session and events are already handled atomically by EMM.
// Just map HandlerResult to SessionResult for the scheduler.
if (result.status === "failed:logic") {
  return { status: "maintenance", ... };
}
if (isFailedStatus(result.status)) {
  return { status: "failed", ... };
}
if (result.status === "paused:transient") {
  return { status: "transient", ... };
}
// etc.
```

### 7. Wire EMM into scheduler's execution context

```typescript
// workflow-scheduler.ts
private createExecutionContext(): HandlerExecutionContext {
  return {
    api: this.api,
    emm: new ExecutionModelManager(this.api),  // NEW
    connectionManager: this.connectionManager,
    userPath: this.userPath,
    schedulerState: this.schedulerState,
  };
}
```

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/handler-state-machine.ts` | Replace failRun/pauseRun/pauseRunForIndeterminate with EMM calls |
| `packages/agent/src/session-orchestration.ts` | Remove session finalization calls, simplify result handling |
| `packages/agent/src/workflow-scheduler.ts` | Add `emm` to execution context |

## Verification

- All existing handler run status transitions go through EMM
- Session finalization is atomic with status change
- Event disposition is atomic with status change
- `turbo run build` passes
- Walk through Bug 1/Bug 2 scenarios to confirm fix
