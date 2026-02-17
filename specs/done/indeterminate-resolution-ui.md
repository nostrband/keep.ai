# Indeterminate Mutation Resolution UI + Scheduler Guard

## Context

When server crashes mid-mutation, the mutation becomes "indeterminate" and the workflow is paused. Multiple problems:

1. **No resolution UI**: Outputs page shows "needs verification" but no action buttons.
2. **No scheduler guard**: If workflow is manually set to "active", scheduler starts new sessions, orphaning the stuck run.
3. **Events wrongly released**: `releaseOrphanedReservedEvents()` uses status-based check, not phase-based.
4. **`pending_retry_run_id` not set for indeterminate mutations**: The only mechanism for the scheduler to retry a specific run is never triggered for indeterminate cases.
5. **`pending_retry_run_id` set unnecessarily for pre-mutation crashes**: Creates needless retry machinery when a fresh start would be better (fresher data from re-reads).

## Core invariant

**The critical boundary is mutation application.** Per docs/dev/06-execution-model.md:

> Before a mutation is applied, execution can reset to `prepare` and start fresh. After mutation is applied, execution must proceed forward through `next` to completion.

This invariant governs THREE things identically:
1. **Event reservation release**: only release if mutation didn't/couldn't happen
2. **`pending_retry_run_id`**: only set (requiring retry-with-copy) if mutation might have or did happen
3. **Run retry behavior**: copy results only when `phase >= mutated`

| Phase | Mutation Status | Release Events? | Set pending_retry? | Retry copies results? |
|-------|----------------|-----------------|--------------------|-----------------------|
| `preparing`, `prepared` | n/a | Yes | No | No (fresh start) |
| `mutating` | `failed` or `pending` | Yes | No | No (fresh start) |
| `mutating` | `in_flight` / `indeterminate` / `needs_reconcile` / `applied` | **No** | **Yes** | No (phase < mutated) |
| `mutated`, `emitting` | any | **No** | **Yes** | **Yes** (must copy) |

## Bugs found

### Bug 1: `releaseOrphanedReservedEvents()` uses status-based check

**File:** `packages/db/src/event-store.ts:375-405`

Current SQL checks `h.status = 'active'`. Should use the phase-based invariant above.

Fix:
```sql
AND NOT EXISTS (
  SELECT 1 FROM handler_runs h
  WHERE h.id = e.reserved_by_run_id
  AND (
    h.status = 'active'
    OR h.phase IN ('mutated', 'emitting')
    OR (h.phase = 'mutating' AND EXISTS (
      SELECT 1 FROM mutations m
      WHERE m.handler_run_id = h.id
      AND m.status NOT IN ('failed', 'pending')
    ))
  )
)
```

### Bug 2: `resumeIncompleteSessions()` indeterminate path doesn't set `pending_retry_run_id`

**File:** `packages/agent/src/session-orchestration.ts:710-733`

The indeterminate path marks the run as `paused:reconciliation` and pauses the workflow, but does NOT set `pending_retry_run_id`. When user later resolves and resumes, the scheduler has no mechanism to find the orphaned run.

Fix: set `pending_retry_run_id` atomically when marking indeterminate.

### Bug 3: `resumeIncompleteSessions()` sets `pending_retry_run_id` for pre-mutation crashes

**File:** `packages/agent/src/session-orchestration.ts:735-768`

Currently sets `pending_retry_run_id` for ALL crashes, including pre-mutation ones (preparing, prepared, mutating with failed mutation). For these, a fresh start is preferable (reads will return fresher data). Only post-mutation phases (mutated, emitting) need retry-with-copy.

Fix: only set `pending_retry_run_id` when the invariant requires it (mutated/emitting phase). For pre-mutation crashes, just mark crashed and close session — `releaseOrphanedReservedEvents` releases events, normal scheduling picks up work.

### Bug 4: `canStartSession()` doesn't account for paused runs

**File:** `packages/agent/src/session-orchestration.ts:989-995`

`hasActiveRun()` queries `WHERE status = 'active'`. A `paused:reconciliation` run doesn't block new sessions. However, with the scheduler guard (section 1 below) and proper `pending_retry_run_id` setting, this becomes defense-in-depth rather than the primary fix.

## Approach

### 1. Scheduler pre-check for indeterminate mutations

**File:** `packages/agent/src/workflow-scheduler.ts`
**Location:** `processNextWorkflow()`, workflow filter loop (line ~408)

```typescript
const indeterminate = await this.api.mutationStore.getByWorkflow(w.id, { status: "indeterminate" });
if (indeterminate.length > 0) {
  this.debug(`Workflow ${w.id} has indeterminate mutations, re-pausing`);
  await this.api.scriptStore.updateWorkflowFields(w.id, { status: 'paused' });
  continue;
}
```

### 2. Fix `pending_retry_run_id` — set only when invariant requires it

**When to SET `pending_retry_run_id`:**

a. **When mutation becomes indeterminate** (any code path) — atomically with indeterminate marking:
   - `resumeIncompleteSessions()` in_flight path (session-orchestration.ts:710-733)
   - `pauseRunForIndeterminate()` in handler state machine (handler-state-machine.ts:448-466)
   - Future: background reconciliation gives up

b. **When consumer fails at mutated/emitting phase** — atomically with run status update:
   - Already handled by crash recovery for `status=active` runs at mutated/emitting
   - Maintainer path: `activateScript()` already sets it (task-worker.ts:804)

c. **On restart, consumer at mutated/emitting with `status=active`** — already handled by crash recovery path in `resumeIncompleteSessions()`

**When to CLEAR `pending_retry_run_id`:**

a. **`retryWorkflowSession()` creates retry run** — already implemented (atomically)
b. **User resolves via "didn't happen"** — clear atomically with resolution
c. **User resolves via "skip"** — clear atomically with resolution

**When to STOP setting `pending_retry_run_id`:**

- Pre-mutation crashes in `resumeIncompleteSessions()` (preparing, prepared, mutating with failed/no mutation): just mark crashed, close session, no pending_retry. Events released by startup orphan cleanup, normal scheduling picks up work.
- Transient errors at pre-mutation phases: same — no pending_retry needed (backoff still applies at workflow level if needed).

### 3. Fix `releaseOrphanedReservedEvents()` — phase-based invariant

**File:** `packages/db/src/event-store.ts:375-405`

Replace status check with phase-based invariant (SQL above in Bug 1).

### 4. Fix `resumeIncompleteSessions()` — split by invariant

**File:** `packages/agent/src/session-orchestration.ts:681-786`

For each incomplete run (status='active'):

a. **Phase is mutating + mutation in_flight**: mark indeterminate, set `pending_retry_run_id`, pause workflow (existing logic + add pending_retry)
b. **Phase is mutated/emitting**: mark crashed, close session, set `pending_retry_run_id` (existing logic, keep only for these phases)
c. **Phase is pre-mutation (preparing/prepared/mutating with failed or no mutation)**: mark crashed, close session, do NOT set `pending_retry_run_id` (simplification — let normal scheduling handle it)

### 5. `useResolveMutation` hook (direct DB writes via cr-sqlite sync)

**File:** `apps/web/src/hooks/dbWrites.ts`

Two actions, no auto-resume:

**"did_not_happen" (user_assert_failed):**
- In a transaction:
  - `api.mutationStore.update(id, { status: "failed", resolved_by: "user_assert_failed", resolved_at: Date.now() })`
  - `api.handlerRunStore.update(run.id, { status: "failed:logic", error: "User confirmed mutation did not complete", end_timestamp })`
  - `api.eventStore.releaseEvents(run.id, tx)` — release reserved events (mutation didn't happen)
  - `api.scriptStore.updateWorkflowFields(run.workflow_id, { pending_retry_run_id: '' })` — clear pending retry
- NO workflow resume

**"skip" (user_skip):**
- In a transaction:
  - `api.mutationStore.update(id, { status: "failed", resolved_by: "user_skip", resolved_at: Date.now() })`
  - `api.eventStore.skipEvents(run.id, tx)`
  - `api.handlerRunStore.update(run.id, { phase: "committed", status: "committed", error: "", end_timestamp })`
  - `api.scriptStore.incrementHandlerCount(run.script_run_id, tx)`
  - `api.scriptStore.updateWorkflowFields(run.workflow_id, { pending_retry_run_id: '' })` — clear pending retry
- NO workflow resume

Sync: `notifyTablesChanged(["mutations", "handler_runs", "workflows", "events"], true, api)`

### 6. Action buttons on WorkflowOutputsPage

**File:** `apps/web/src/components/WorkflowOutputsPage.tsx`

For `status === "indeterminate"` mutations, two buttons below warning text:
- **"It didn't happen"** → `did_not_happen`
- **"Skip"** → `skip`

No "It happened" — requires fetching mutated object's value, out of scope for v1.

### 7. Hide "Resume" button when indeterminate mutations exist

**File:** `apps/web/src/components/WorkflowDetailPage.tsx` (or wherever the Resume button lives)

If the workflow has indeterminate mutations (use `usePendingReconciliation` hook), replace the "Resume" button with a "Resolve" button in red/amber styling that navigates to `/workflow/{id}/outputs?filter=indeterminate` — the same page the top warning banner links to. Gives the user a clear path: resolve the indeterminate mutation first, then resume becomes available.

## Files to modify

1. `packages/db/src/event-store.ts` — fix `releaseOrphanedReservedEvents()` SQL
2. `packages/agent/src/session-orchestration.ts` — fix `resumeIncompleteSessions()` (split by invariant, set pending_retry for indeterminate)
3. `packages/agent/src/handler-state-machine.ts` — `pauseRunForIndeterminate()` set pending_retry atomically
4. `packages/agent/src/workflow-scheduler.ts` — scheduler guard for indeterminate mutations
5. `apps/web/src/hooks/dbWrites.ts` — `useResolveMutation` hook
6. `apps/web/src/components/WorkflowOutputsPage.tsx` — action buttons

## Verification

1. Crash mid-mutation → restart → mutation indeterminate, pending_retry_run_id set, workflow paused, events NOT released
2. Set workflow to "active" manually → scheduler re-pauses immediately (guard)
3. Navigate to outputs page → see "It didn't happen" and "Skip" buttons
4. Click "It didn't happen" → mutation=failed, run=failed:logic, events released, pending_retry cleared, workflow stays paused
5. Click "Skip" → mutation=failed, events skipped, run committed, pending_retry cleared, workflow stays paused
6. Manually resume workflow → scheduler allows it, starts fresh session, no orphaned runs
7. Pre-mutation crash → restart → no pending_retry set, events released, normal scheduling picks up work
8. Post-mutation crash (mutated/emitting) → restart → pending_retry set, events NOT released, scheduler retries with copy

## Implementation note

After all changes are made, the implementing agent MUST do a final pass over the modified codebase to verify that the core invariant holds consistently across all code paths. Specifically:

1. Grep for all places that call `releaseEvents`, `releaseOrphanedReservedEvents`, `skipEvents` — verify each respects the phase-based invariant (no release when mutation might have or did happen).
2. Grep for all places that set or clear `pending_retry_run_id` — verify it is set exactly when the invariant requires (mutated/emitting phase, or indeterminate mutation) and cleared on resolution or retry creation.
3. Grep for all places that call `markIndeterminate` — verify each atomically sets `pending_retry_run_id` alongside.
4. Grep for all places that create retry runs or call `shouldCopyResults` — verify results are copied only for `phase >= mutated`.
5. Verify `resumeIncompleteSessions` handles all three paths (pre-mutation, indeterminate, post-mutation) correctly per the invariant table.
6. Verify the scheduler guard in `processNextWorkflow` prevents any execution when indeterminate mutations exist.
7. Verify UI resolution actions ("didn't happen", "skip") clear `pending_retry_run_id` and properly handle events (release vs skip).
