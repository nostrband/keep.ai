# Fix 01: Reconciliation Scheduler — Full EMM Integration

**Priority:** CRITICAL
**File:** `packages/agent/src/reconciliation/scheduler.ts`
**Estimated scope:** ~100 lines changed, ~50 lines removed

## Problem

The entire reconciliation scheduler predates EMM and uses raw store calls for
all mutation/workflow/handler-run operations. This causes:

1. **`handleApplied()`** — calls `mutationStore.markApplied()` directly.
   Missing: `mutation_outcome = "success"`, phase advance to `mutated`,
   `workflow.error` clearing, `pending_retry_run_id` for re-execution.

2. **`handleFailed()`** — calls `mutationStore.markFailed()` directly.
   Missing: `mutation_outcome = "failure"`, event release, `pending_retry_run_id`
   clearing, `workflow.error` clearing.

3. **`handleExhausted()`** — calls `mutationStore.markIndeterminate()` +
   sets `workflow.status = "paused"` (should use `workflow.error`, since this is
   system-controlled) + sets `pending_retry_run_id` (already set from initial
   `paused:reconciliation`).

4. **`resumeWorkflow()`** — sets `handlerRun.status = "active"` via direct
   `handlerRunStore.update()` and `workflow.status = "active"`. This bypasses
   EMM completely. Setting status back to "active" leaves a zombie run that
   `recoverCrashedRuns()` would mishandle on next restart.

5. **Latent crash-window bug:** `mutation_outcome` is never set, so a crash
   between reconciliation resolution and workflow resume leaves the run in an
   inconsistent state — `recoverCrashedRuns()` would misclassify the recovery
   path.

## Analysis: How reconciliation fits the EMM model

When a mutation becomes uncertain during handler execution:
1. `emm.updateHandlerRunStatus(runId, "paused:reconciliation")` runs atomically:
   - Sets handler run status to `paused:reconciliation`
   - Sets `pending_retry_run_id = runId` (phase=mutating, mutation_outcome="")
   - Sets `workflow.error = "Mutation outcome uncertain"`
   - Finalizes the session as failed
2. The reconciliation scheduler periodically checks for `needs_reconcile` mutations
3. After resolution, the workflow needs to proceed:
   - **Applied:** pending_retry_run_id → scheduler calls `createRetryRun()` → new
     run at emitting phase → executes next()
   - **Failed:** events released, no retry needed → scheduler runs fresh session
   - **Exhausted:** mutation goes `indeterminate` → user must decide

Key insight: `resumeWorkflow()` is wrong — we never "resume" the old run. Instead:
- Applied: existing `pending_retry_run_id` (already set) triggers a retry
- Failed: events released, `pending_retry_run_id` cleared, fresh session runs

## EMM Extension

### Extend `ApplyMutationOpts` with `resolvedBy` / `resolvedAt`

Add audit tracking fields to `ApplyMutationOpts` (same as `FailMutationOpts`):

```typescript
export interface ApplyMutationOpts {
  result?: string;
  resolvedBy?: MutationResolution | "";
  resolvedAt?: number;
}
```

No `setPendingRetry` needed — when the run entered `paused:reconciliation`,
EMM's `_handleEventDisposition` already set `pending_retry_run_id`. Clearing
`workflow.error` (which `applyMutation` already does) unblocks the scheduler
to process the existing pending retry. For `failMutation`, it clears
`pending_retry_run_id` and releases events, giving the consumer a clean slate.

### No new methods needed

- `failMutation()` already supports `resolvedBy` — reconciliation just calls it
- `updateMutationStatus()` handles the exhausted→indeterminate transition
- No `resumeWorkflow()` equivalent needed in EMM

## Changes

### 1. Extend `ApplyMutationOpts` (execution-model.ts)

Add `resolvedBy`, `resolvedAt`, `setPendingRetry` fields as described above.
Add the conditional `pending_retry_run_id` set inside `applyMutation()`.
Pass `resolved_by`/`resolved_at` to the mutation update.

### 2. Add EMM to reconciliation scheduler constructor

```typescript
export interface ReconciliationSchedulerConfig {
  api: KeepDbApi;
  policy?: ReconciliationPolicy;
  checkIntervalMs?: number;
}
```

The scheduler creates `new ExecutionModelManager(api)` in constructor (same
pattern as WorkflowScheduler).

### 3. Replace `handleApplied()`

Before:
```typescript
await this.api.mutationStore.markApplied(mutation.id, result);
await this.resumeWorkflow(mutation);
```

After:
```typescript
await this.emm.applyMutation(mutation.id, {
  result: result ? JSON.stringify(result) : "",
  resolvedBy: "reconciliation",
  setPendingRetry: true,
});
// No resumeWorkflow — pending_retry_run_id triggers scheduler retry path
```

### 4. Replace `handleFailed()`

Before:
```typescript
await this.api.mutationStore.markFailed(mutation.id, error);
await this.resumeWorkflow(mutation);
```

After:
```typescript
await this.emm.failMutation(mutation.id, {
  error: "Reconciliation confirmed mutation did not complete",
  resolvedBy: "reconciliation",
});
// No resumeWorkflow — events released, fresh session picks them up
```

### 5. Replace `handleExhausted()`

Before:
```typescript
await this.api.db.db.tx(async (tx) => {
  await this.api.mutationStore.markIndeterminate(mutation.id, error, tx);
  await this.api.scriptStore.updateWorkflowFields(mutation.workflow_id, {
    status: "paused",
    pending_retry_run_id: mutation.handler_run_id,
  }, tx);
});
```

After:
```typescript
await this.emm.updateMutationStatus(mutation.id, "indeterminate", {
  error: `Reconciliation exhausted after ${mutation.reconcile_attempts} attempts`,
});
// workflow.error and pending_retry_run_id already set when run entered
// paused:reconciliation — no need to touch them here.
// IMPORTANT: do NOT set workflow.status = "paused" — status is user-controlled.
```

### 6. Delete `resumeWorkflow()`

Remove the entire method (~30 lines). Both resolution paths (applied → retry,
failed → fresh session) are handled by the scheduler's existing mechanisms.

### 7. Update `scheduleNextAttempt()`

This method calls `mutationStore.scheduleNextReconcile()`. This is a mutation-only
update (scheduling metadata), not a state transition. It can stay as a direct
store call — `updateMutationStatus` doesn't handle scheduling fields.

Actually, check: does `UpdateMutationStatusOpts` support `nextReconcileAt`? Yes:
```typescript
if (opts?.nextReconcileAt !== undefined) updateFields.next_reconcile_at = opts.nextReconcileAt;
```

So we could use EMM here too. But `scheduleNextReconcile` likely also increments
`reconcile_attempts`, which `updateMutationStatus` doesn't do. Keep the direct
store call for scheduling metadata — it's not a state transition.

## Testing

- Verify reconciliation-applied → `pending_retry_run_id` set → scheduler creates
  retry → next() runs → consumer committed
- Verify reconciliation-failed → events released → fresh session processes events
- Verify reconciliation-exhausted → mutation=indeterminate, no workflow.status change
- Verify `resumeWorkflow` removal doesn't break anything (no other callers)
- Build with `turbo run build`
