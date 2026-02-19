# Fix 02: Web UI Mutation Resolution — EMM-Consistent State Transitions

**Priority:** CRITICAL
**File:** `apps/web/src/hooks/dbWrites.ts` (function `useResolveMutation`)
**Estimated scope:** ~30 lines changed

## Problem

The web UI's `useResolveMutation` hook performs indeterminate mutation resolution
with manual store calls that bypass EMM, causing:

1. **Missing `mutation_outcome`** — neither "did_not_happen" nor "skip" sets
   `mutation_outcome` on the handler run. If crash recovery runs later, it would
   misclassify the run.

2. **"skip" has a semantic bug** — the web UI directly commits the run
   (`phase: "committed"`, `status: "committed"`), which skips the `next()` call
   entirely. EMM's `skipMutation()` correctly sets `pending_retry_run_id` so the
   scheduler creates a retry run at emitting phase, which executes `next()`.
   The `next()` function updates consumer state and may produce events — skipping
   it can leave the consumer in a stale state.

3. **Missing `workflow.error` clearing** — neither path clears `workflow.error`,
   so the scheduler remains blocked even after the user resolves the mutation.

## Approach

The web app cannot import from `@app/agent` (would pull in too many
dependencies). Instead, we update the store operations in the hook to match
EMM semantics exactly. This is acceptable duplication for a single UI hook —
the operations are simple and well-documented.

## Changes

### "did_not_happen" path

Semantics: user confirms mutation did not complete → `failMutation` equivalent.

Before:
```typescript
await api.mutationStore.update(mutation.id, {
  status: "failed",
  resolved_by: "user_assert_failed",
  resolved_at: now,
}, tx);
await api.handlerRunStore.update(run.id, {
  status: "failed:logic" as any,
  error: "User confirmed mutation did not complete",
  end_timestamp: endTimestamp,
}, tx);
await api.eventStore.releaseEvents(run.id, tx);
await api.scriptStore.updateWorkflowFields(run.workflow_id, {
  pending_retry_run_id: '',
}, tx);
```

After:
```typescript
// Mutation → failed (matches emm.failMutation)
await api.mutationStore.update(mutation.id, {
  status: "failed",
  resolved_by: "user_assert_failed",
  resolved_at: now,
}, tx);
// Set mutation_outcome on handler run (EMM invariant)
await api.handlerRunStore.update(run.id, {
  mutation_outcome: "failure",
  phase: "mutated",    // advance phase (mutate complete, outcome known)
}, tx);
// Release events — mutation didn't happen, events can be reprocessed
await api.eventStore.releaseEvents(run.id, tx);
// Clear pending_retry + workflow.error (mutation resolved)
await api.scriptStore.updateWorkflowFields(run.workflow_id, {
  pending_retry_run_id: '',
  error: '',
}, tx);
```

Note: we do NOT set `status: "failed:logic"` on the handler run. The run stays
`paused:reconciliation` — it was already finalized by `updateHandlerRunStatus`
when it first entered that status. The session is already closed. Setting
`failed:logic` would trigger maintenance mode (which we don't want for user
resolution) and try to re-finalize the session.

### "skip" path

Semantics: user wants to skip this event → `skipMutation` equivalent.

Before (BUGGY — commits run directly, skipping next()):
```typescript
await api.mutationStore.update(mutation.id, {
  status: "failed",
  resolved_by: "user_skip",
  resolved_at: now,
}, tx);
await api.eventStore.skipEvents(run.id, tx);
await api.handlerRunStore.update(run.id, {
  phase: "committed" as any,
  status: "committed" as any,
  error: "",
  end_timestamp: endTimestamp,
}, tx);
await api.scriptStore.incrementHandlerCount(run.script_run_id, tx);
await api.scriptStore.updateWorkflowFields(run.workflow_id, {
  pending_retry_run_id: '',
}, tx);
```

After (matches emm.skipMutation — sets up retry for next()):
```typescript
// Mutation → failed/skipped (matches emm.skipMutation)
await api.mutationStore.update(mutation.id, {
  status: "failed",
  resolved_by: "user_skip",
  resolved_at: now,
}, tx);
// Set mutation_outcome on handler run (EMM invariant)
await api.handlerRunStore.update(run.id, {
  mutation_outcome: "skipped",
  phase: "mutated",    // advance phase (mutate complete, outcome known)
}, tx);
// Skip events — mark as terminal
await api.eventStore.skipEvents(run.id, tx);
// Set pending_retry (for next() execution via retry) + clear error
await api.scriptStore.updateWorkflowFields(run.workflow_id, {
  pending_retry_run_id: run.id,
  error: '',
}, tx);
```

Key difference: the run is NOT committed. Instead `pending_retry_run_id` is set,
which triggers the scheduler to call `createRetryRun()` → new run at emitting
phase → executes `next()` with `mutationResult = { status: "skipped" }`.

### Update `notifyTablesChanged`

Current:
```typescript
notifyTablesChanged(["mutations", "handler_runs", "workflows", "events"], true, api!);
```

Keep as-is — same tables are touched.

## Important: UI behavior change for "skip"

Previously "skip" was instant (committed the run directly). Now it sets up a
pending retry, which means the consumer loop must run before the skip is fully
processed. The UI should reflect this:
- The workflow card may show "pending retry" briefly after skip
- The actual skip processing happens on the next scheduler tick

This is the CORRECT behavior — `next()` must always run for skipped events to
update consumer state.

## Testing

- Verify "did_not_happen" → events released → fresh session processes events
- Verify "skip" → `pending_retry_run_id` set → scheduler creates retry →
  next() runs with skipped result → consumer committed
- Verify both paths clear `workflow.error`
- Verify neither path sets maintenance mode
- Build with `turbo run build`
