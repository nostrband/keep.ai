# Integration Topic 8: Retry Path

> Depends on: Topic 2 (handler run status), Topic 4 (commit operations), Topic 6 (session lifecycle)

## Summary

Replace `retryWorkflowSession()` in `session-orchestration.ts` with the EMM's
`createRetryRun()` plus simplified session orchestration. Also replace the old
`createRetryRun()` in `handler-state-machine.ts`.

The key improvement: event reservation transfer is now atomic with retry creation.
This fixes Bug 4 (post-mutation retry never transfers event reservations).

## Current State

### `retryWorkflowSession()` in session-orchestration.ts (lines 886-1061)

1. Load failed handler run
2. Check if already retried (race protection)
3. Compute phase reset (getStartPhaseForRetry)
4. Create new session
5. Atomic: create retry run + clear pending_retry + release events (if pre-mutation)
6. Execute retry run
7. Handle result (same if/else chain)
8. If committed, continue consumer loop

**Missing:** No `transferReservations()` call — Bug 4.

### `createRetryRun()` in handler-state-machine.ts (lines 330-391)

Older retry creation function. Atomic: mark previous run + create new run.
Used by some paths (indeterminate-resolution.ts).

### Scheduler — pending_retry handling

In `processNextWorkflow()` (workflow-scheduler.ts lines 469-501):
1. Check `workflow.pending_retry_run_id`
2. Skip if in retry backoff
3. Call `retryWorkflowSession(workflow, failedRunId, context)`

### Scheduler — transient retry

`handleSessionResult()` sets `pending_retry_run_id` for transient errors:
```typescript
case 'transient':
  await this.api.scriptStore.updateWorkflowFields(workflowId, {
    pending_retry_run_id: result.handlerRunId || '',
  });
```

**But:** With EMM, `updateHandlerRunStatus(paused:transient)` already sets
`pending_retry_run_id` atomically for post-mutation transient errors. For
pre-mutation transient errors, events are released and no pending_retry is needed
(fresh run picks up released events). So this scheduler code may be redundant
or even conflicting.

## Changes Required

### 1. Replace `retryWorkflowSession()` with EMM-based version

The new flow:
1. Load failed handler run (same as before)
2. Check if already retried (same as before)
3. Create new session
4. Call `emm.createRetryRun(failedRunId, sessionId)`
   - This atomically: creates retry run + transfers reservations + clears pending_retry
5. Execute retry run via `executeHandler()`
6. Handle result (simplified — no finalization calls needed)
7. If committed, continue consumer loop

```typescript
export async function retryWorkflowSession(
  workflow: Workflow,
  failedHandlerRunId: string,
  context: HandlerExecutionContext
): Promise<SessionResult> {
  const { api, emm } = context;

  // 1. Load failed handler run
  const failedRun = await api.handlerRunStore.get(failedHandlerRunId);
  if (!failedRun) {
    await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
    return executeWorkflowSession(workflow, "event", context);
  }

  // 2. Check if already retried
  const existingRetries = await api.handlerRunStore.getRetriesOf(failedHandlerRunId);
  if (existingRetries.length > 0) {
    await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
    return executeWorkflowSession(workflow, "event", context);
  }

  // 3. Create new session
  const sessionId = bytesToHex(randomBytes(16));
  await api.scriptStore.startScriptRun(sessionId, ...);

  // 4. Create retry run via EMM (atomic with reservation transfer)
  const retryRun = await emm.createRetryRun(failedHandlerRunId, sessionId);

  // 5. Execute retry run
  const handlerResult = await executeHandler(retryRun.id, context);

  // 6. Map result to SessionResult (no finalization calls — already in EMM)
  if (handlerResult.status === "failed:logic") {
    return { status: "maintenance", ... };
  }
  // ... etc

  // 7. If committed, continue consumer loop
  return await continueSession(api, workflow, session, context);
}
```

### 2. Remove old `createRetryRun()` from handler-state-machine.ts

After updating all callers, the old `createRetryRun()` (lines 330-391) and
related helpers (`shouldCopyResults`, `getStartPhaseForRetry`) can be removed.

**Check callers:** `indeterminate-resolution.ts` may use the old `createRetryRun`.
If so, update it to use EMM's `createRetryRun()` instead.

### 3. Remove redundant `pending_retry_run_id` setting in scheduler

```typescript
// BEFORE (in handleSessionResult, case 'transient'):
await this.api.scriptStore.updateWorkflowFields(workflowId, {
  pending_retry_run_id: result.handlerRunId || '',
});

// AFTER: Remove this.
// EMM's updateHandlerRunStatus(paused:transient) already handles this:
// - Post-mutation: sets pending_retry_run_id atomically
// - Pre-mutation: releases events (no pending_retry needed)
```

### 4. Update transient retry flow

With EMM:
- **Pre-mutation transient**: Events released by EMM. Scheduler does fresh session
  (no pending_retry_run_id). Standard backoff still applies.
- **Post-mutation transient**: Events preserved, pending_retry_run_id set by EMM.
  Scheduler processes via createRetryRun after backoff.

The scheduler's retry backoff mechanism (workflowRetryState map) still applies.
But the signal routing changes:
- Pre-mutation transient → no pending_retry → scheduler runs fresh session after backoff
- Post-mutation transient → pending_retry → scheduler runs retry session after backoff

The scheduler needs to distinguish these. Currently it always sets pending_retry_run_id
for transient. With EMM, only post-mutation transient gets pending_retry.

### 5. Consider: what triggers backoff for pre-mutation transient?

Currently: `handleSessionResult('transient')` → set pending_retry + retry signal.
With EMM: pre-mutation transient → no pending_retry_run_id.

Options:
a. Scheduler still tracks backoff per-workflow (in-memory). Fresh sessions
   respect backoff. This is the current behavior for non-retry sessions.
b. The SessionResult still indicates "transient" so the scheduler knows to
   apply backoff. Scheduler just doesn't set pending_retry (EMM didn't set it either).

Option (b) is simpler — keep the signal routing for backoff, just remove the
redundant pending_retry_run_id setting.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/session-orchestration.ts` | Replace retryWorkflowSession internals |
| `packages/agent/src/handler-state-machine.ts` | Remove old createRetryRun + helpers |
| `packages/agent/src/workflow-scheduler.ts` | Remove redundant pending_retry_run_id setting |
| `packages/agent/src/indeterminate-resolution.ts` | Update to use EMM.createRetryRun (if applicable) |

## Verification

- Bug 4 fixed: retryRun has correct event reservations via transferReservations
- Post-mutation retry: events transferred, next() executes with correct context
- Pre-mutation retry: events already released, fresh session picks them up
- Transient retry backoff still works for both pre/post-mutation
- `turbo run build` passes
- Walk through scenarios 2, 4, 8 from spec
