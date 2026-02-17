# Execution State Consolidation

> References: docs/dev/06-execution-model.md, docs/dev/06b-consumer-lifecycle.md,
> docs/dev/09-failure-repair.md, docs/dev/16-scheduling.md

## Problem Statement

The abstract execution model (Chapter 06) defines:

1. **Handler run phase** — consumer execution progress: `preparing → prepared → mutating → mutated → emitting → committed`
2. **Handler run status** — orthogonal to phase: `active | paused:* | failed:* | committed | crashed`
3. **Event status** — `pending → reserved → consumed | skipped`
4. **Mutation status** — `pending → in_flight → applied | failed | needs_reconcile | indeterminate`

Chapter 06 specifies: "The critical boundary is mutation application. Before mutation is applied,
execution can reset to prepare and start fresh. After mutation is applied, execution must
proceed forward through next to completion."

Chapter 06b specifies: "Phase only moves forward. There is no failed state in the phase diagram.
Failures pause execution but do not change the phase."

Chapter 16 specifies: "Status changes do not change phase. Phase only advances forward on
successful completion of each phase."

The abstract model does NOT define:
- **Session/script_run** — our implementation-level grouping of handler runs, a convenience for
  display/history, not used by scheduler for decisions. Result is simply `completed` | `failed`.
  The `suspended` status is eliminated — sessions are never resumed, so a session that ended
  because of a paused handler is just `failed`. The handler_run status (`paused:approval`,
  `paused:reconciliation`, etc.) carries the detail.
- **Workflow status** — our UX-level concept. Abstract model roughly defines `active` (scheduler
  considers) and `paused` (scheduler ignores). Other values (`error`, `draft`, `ready`) are UX.
- **`maintenance` flag** — our auto-fix mechanism, pauses scheduler consideration
- **`pending_retry_run_id`** — our mechanism for linking a failed run to its future retry

These implementation details are within our control to change if needed.

### Current bugs

Currently the abstract model's invariants are violated because critical state changes are
scattered across 4+ files with inconsistent transaction boundaries:

**Bug 1: Post-mutation logic failure orphans events.** Consumer fails in `emitting` phase with
logic error → `failRun()` updates handler status (bare write) → session returns `maintenance` →
`handleSessionResult('maintenance')` never sets `pending_retry_run_id` → event stuck `reserved` forever.

**Bug 2: Non-atomic state transitions.** `failRun()` writes handler status in one call, then
later (non-atomically) the scheduler writes `pending_retry_run_id` or events are released.
Crash between them = inconsistent state.

**Bug 3: `releaseOrphanedReservedEvents` doesn't check run status.** SQL uses `h.phase IN
('mutated', 'emitting')` without checking `h.status`. Dead (failed:logic) run in emitting phase
blocks release forever.

**Bug 4: Post-mutation retry never transfers event reservations.** `retryWorkflowSession` creates
retry run for post-mutation failure but events remain `reserved_by_run_id = OLD_RUN_ID`. When
retry succeeds, `consumeEvents(NEW_RUN_ID)` matches zero rows.

**Bug 5: Crash recovery misses non-active runs.** `resumeIncompleteSessions` only finds
`status='active'`. If process crashes after `failRun()` wrote terminal status but before
`pending_retry_run_id` was set, crash recovery misses the run.

---

## Proposed Model: ExecutionModelManager

A single class (`packages/agent/src/execution-model.ts`) that owns ALL transitions of the
abstract model's controlled variables. No other code may directly modify handler run status, handler run phase, event status
(reserve/unreserve/consume/skip/transfer), or script run status, or mutation outcome on handler runs.

### New field: `mutation_outcome` on handler_runs

Values: `""` | `"success"` | `"failure"` | `"skipped"`

Denormalized from mutations table — set when mutation reaches terminal state. Serves as a fast
local signal for recovery decisions without joining to mutations table.

---

## Core Methods

### Method 1: `updateHandlerRunStatus(runId, newStatus, opts?)`

Called when a handler run's status changes (failure, pause, or commit).

```
TRANSACTION {
  1. Update handler_run: status, error, error_type, end_timestamp

  2. Consumer event disposition (based on phase + mutation_outcome):
     Only for non-committed statuses (failure/paused):
     a. Pre-mutation: phase < mutated, or mutation_outcome = "failure"
        → releaseEvents(runId)
     b. Post-mutation: phase in (mutated, emitting) AND mutation_outcome != "failure"
        → set workflow.pending_retry_run_id = runId
        → events stay reserved
     c. Indeterminate: phase = mutating AND mutation in_flight/needs_reconcile/indeterminate
        → set workflow.pending_retry_run_id = runId
        → set workflow.status = "paused"
        → events stay reserved

  3. Session finalization (only on failure/paused — NOT on committed):
     → finalize script_run (via handler_run.script_run_id) with result="failed", aggregated cost, error
     Handler failure always ends the session. Committed runs don't — the scheduler
     may run more consumers in the same session. No "suspended" result — a session
     ended by a paused handler is simply "failed"; the handler_run status carries the detail.

  4. Maintenance flag (only for failed:logic):
     - failed:logic → set workflow.maintenance = true
     Atomic with the rest — no crash window between failure and maintenance flag.
     Maintainer task creation happens AFTER the tx (external operation).
     If crash before task creation: startup recovery finds maintenance=true with
     no active maintainer task → creates one (see recoverMaintenanceMode).

  5. Workflow status derivation (only on failure/paused — NOT on committed):
     - paused:approval → workflow.status = "error"
     - failed:internal → workflow.status = "error"
     - failed:logic → workflow stays active (maintenance flag handles scheduling)
     - paused:transient → workflow stays active (retry will handle)
     - paused:reconciliation → workflow.status = "paused"
}
```

**Who calls it:**
- Handler state machine on any error (replaces `failRun`, `pauseRun`, `pauseRunForIndeterminate`)
- Crash recovery
- Internally by `commitConsumer()` and `skipMutation()` for the committed path

For the success path where the session has no more work, session finalization is handled
separately by `finishSession()`.

---

### Method 2: `updateConsumerPhase(runId, newPhase, opts?)`

Called when consumer advances to next phase. Phase-specific side effects are atomic.

```
Phase-specific behavior:

  preparing → prepared:
    TRANSACTION {
      Update phase = "prepared"
      reserveEvents(runId, opts.reservations)
      Save prepare_result
    }

  prepared → mutating:
    Update phase = "mutating"

  mutating → mutated:
    Update phase = "mutated"

  mutated → emitting:
    Update phase = "emitting"
```

**Throws if `newPhase = "committed"`.** Use `commitConsumer()` instead (see below).

**`preparing → prepared` is the only phase transition with event side effects** (reservation).
All other non-terminal transitions are pure phase updates.

---

### Method 3: `commitConsumer(runId, opts?)`

Dedicated method for the `→ committed` transition. Internally calls `updateHandlerRunStatus`
in the same transaction.

```
TRANSACTION {
  consumeEvents(runId)
  Update handler state (output_state) if provided
  Update phase = "committed"
  Update status = "committed" via updateHandlerRunStatus logic
  Increment session handler_run_count
}
```

**Why separate from `updateConsumerPhase`?** `committed` is fundamentally different — it touches
events (consumed), status (committed), and session (count). Bundling it prevents callers from
forgetting the status update. The `updateConsumerPhase` method throws on "committed" to prevent
misuse.

---

### Method 4: `updateMutationResult(mutationId, outcome, opts?)`

Called when a mutation reaches terminal state.

```
outcome = "success":
  TRANSACTION {
    mutation.status = "applied"
    handler_run.mutation_outcome = "success"
  }

outcome = "failure":
  TRANSACTION {
    mutation.status = "failed" (+ resolved_by, resolved_at if provided)
    handler_run.mutation_outcome = "failure"
    releaseEvents(runId)
    clear workflow.pending_retry_run_id (if set)
  }
```

**Throws if `outcome = "skipped"`.** Use `skipMutation()` instead (see below).

**Who calls it:**
- Mutation execution on immediate success/failure
- Reconciliation scheduler (tbd) on reconcile outcome
- User UI: "didn't happen" click → `outcome = "failure"`

---

### Method 5: `skipMutation(mutationId, opts?)`

Dedicated method for user "skip" action. Internally calls `updateHandlerRunStatus`.

```
TRANSACTION {
  mutation.status = "failed", resolved_by = "user_skip"
  handler_run.mutation_outcome = "skipped"
  skipEvents(runId) — events marked "skipped"
  handler_run phase = "committed", status = "committed"
    (via internal updateHandlerRunStatus/commit logic)
  clear workflow.pending_retry_run_id
  increment session handler_run_count
}
```

**Why separate?** "Skip" is a complex combined operation: it resolves the mutation AND
commits the run AND marks events as skipped. Making it a dedicated method prevents callers
from having to coordinate `updateMutationResult` + `updateHandlerRunStatus` + event skip
in one transaction manually.

---

### Method 6: `createRetryRun(failedRunId, sessionId, opts?)`

Called by scheduler when processing `pending_retry_run_id`.

**Invariant: only called for post-mutation runs.** `pending_retry_run_id` is only set by
`updateHandlerRunStatus` for post-mutation failures (phase >= mutated, mutation_outcome != "failure")
or indeterminate mutations. Pre-mutation failures release events and never set `pending_retry_run_id`.
Throws if the failed run is pre-mutation — guards against caller misuse. Single-threaded scheduler
means no races, just a programming error if this fires.

```
TRANSACTION {
  Assert failed run is post-mutation (throw otherwise)
  Determine startPhase from failed run phase (emitting)
  Create new handler_run (retry_of = failedRunId, phase = startPhase)
  Copy prepare_result and mutation_result from failed run
  transferReservations(failedRunId, newRunId)
  Clear workflow.pending_retry_run_id
}
```

**`transferReservations`** — new operation:
```sql
UPDATE events SET reserved_by_run_id = ?
WHERE reserved_by_run_id = ? AND status = 'reserved'
```

This fixes Bug 4: ensures `consumeEvents(newRunId)` works when retry succeeds.

---

### Method 7: `finishSession(sessionId)`

Simple, non-critical method for the success path. Called by scheduler when session has no more
work (all consumers processed).

```
Aggregate cost from handler runs
Finalize script_run (result = "completed", end_timestamp)
```

Script_run result is `completed` | `failed`. No `suspended` — sessions are never resumed.

**Not transactional with handler runs** — this is a derivative record. If the process crashes
before this runs, the session stays open. Recovered on startup by `recoverUnfinishedSessions()`
(see auxiliary methods).

---

### Auxiliary methods

**`pauseWorkflow(workflowId)`** — user clicks pause. Only sets `workflow.status = "paused"`.
Does NOT touch handler runs, events, or mutations.

**`resumeWorkflow(workflowId)`** — user clicks resume. Sets `workflow.status = "active"`.
Does NOT touch handler runs, events, or mutations.

**`createMaintenanceTask(workflowId, ...)`** — called after `updateHandlerRunStatus` tx commits
for `failed:logic`. Creates the maintainer task (planner/AI — external operation). The
`maintenance = true` flag is already set atomically by `updateHandlerRunStatus`. If crash
before this call: `recoverMaintenanceMode()` handles it on startup.

**`exitMaintenanceMode(workflowId)`** — called after maintainer fixes script. Sets
`workflow.maintenance = false`. Does NOT clear `pending_retry_run_id` — if one was set by
`updateHandlerRunStatus` for a post-mutation failure, the scheduler will process it via
`createRetryRun` after maintenance clears.

**`recoverMaintenanceMode()`** — startup recovery. Finds workflows with `maintenance = true`
and no active maintainer task → creates one. Covers the crash window between
`updateHandlerRunStatus` tx (sets flag) and `createMaintenanceTask` (creates task).

**`recoverCrashedRuns()`** — startup recovery. Finds `status='active'` handler runs and applies
mutation-boundary logic to determine recovery path (reuses same pre/post-mutation logic as
`updateHandlerRunStatus`).

**`recoverUnfinishedSessions()`** — startup recovery. Finds open sessions (no `end_timestamp`)
where all handler runs are committed. Calls `finishSession()` for each. Independent of
`recoverCrashedRuns()` — no ordering dependency. Sessions with failed/paused runs are already
finalized by the `updateHandlerRunStatus` call that set the terminal status. Sessions with
active (crashed) runs are handled by `recoverCrashedRuns` which calls `updateHandlerRunStatus`
and finalizes the session atomically. This method only covers the gap: all runs committed but
`finishSession()` didn't run before crash.

---

### Event operations (internal, not public API)

These are called only by the methods above, never directly by external code:

- `reserveEvents(runId, reservations)` — called by `updateConsumerPhase(prepared)`
- `consumeEvents(runId)` — called by `commitConsumer()`
- `releaseEvents(runId)` — called by `updateHandlerRunStatus` (pre-mutation) and `updateMutationResult(failure)`
- `skipEvents(runId)` — called by `skipMutation()`
- `transferReservations(fromRunId, toRunId)` — called by `createRetryRun()` (post-mutation)

---

### `releaseOrphanedReservedEvents()` — removed

With the new model, all event transitions happen atomically inside the methods above. Every
crash scenario is covered by `recoverCrashedRuns()` which calls `updateHandlerRunStatus` and
handles events atomically. There is no gap that produces orphaned reserved events.

If orphaned reserved events exist, it's a bug in the execution model — silently releasing
them would hide the bug. Replace with a **startup diagnostic assertion**:

```
assertNoOrphanedReservedEvents():
  Find events WHERE status = 'reserved'
    AND reserved_by_run_id NOT IN (active runs)
    AND reserved_by_run_id NOT IN (workflows.pending_retry_run_id)
  If any found → log loud error with details (event ids, run ids, run statuses)
  Do NOT release them — surface the bug for investigation
```

Run after `recoverCrashedRuns()` so active runs are already handled.

---

## Scenario Walk-through

### 1. Consumer fails in `preparing` phase (logic error)

```
Handler state machine detects error in prepare()
→ updateHandlerRunStatus(runId, "failed:logic", { error })
  TX {
    handler_run.status = "failed:logic", phase stays "preparing"
    Phase is pre-mutation → releaseEvents(runId)
    Finalize session (result="failed", error)
    Workflow stays active (logic → maintenance)
  }
→ Caller returns { status: "maintenance" }
→ Scheduler calls createMaintenanceTask() (maintenance flag already set in tx)
→ Planner fixes script, calls exitMaintenanceMode()
→ No pending_retry_run_id → scheduler runs fresh session
→ Fresh run peeks released events → processes normally
```

### 2. Consumer fails in `emitting` phase (logic error) — THE BUG CASE

```
Handler state machine detects error in next()
→ updateHandlerRunStatus(runId, "failed:logic", { error })
  TX {
    handler_run.status = "failed:logic", phase stays "emitting"
    Phase is post-mutation, mutation_outcome = "success"
      → set workflow.pending_retry_run_id = runId
      → events stay reserved
    Finalize session
    Workflow stays active (logic → maintenance)
  }
→ Scheduler calls createMaintenanceTask() (maintenance flag already set in tx)
→ Planner fixes script, calls exitMaintenanceMode()
→ pending_retry_run_id is still set → scheduler Priority 1 picks it up
→ createRetryRun(failedRunId, newSessionId)
  TX {
    Phase was emitting → copyResults = true, startPhase = "emitting"
    Create new handler_run (retry_of = old, phase = "emitting")
    transferReservations(oldRunId, newRunId)
    Clear pending_retry_run_id
  }
→ Retry executes emitting phase with fixed script
→ commitConsumer(newRunId)
  TX {
    consumeEvents(newRunId) — works! (reservations transferred)
    phase = "committed", status = "committed"
  }
```

### 3. Transient error in `preparing` phase

```
→ updateHandlerRunStatus(runId, "paused:transient", { error })
  TX {
    handler_run.status = "paused:transient"
    Phase is pre-mutation → releaseEvents(runId)
    Finalize session
    Workflow stays active
  }
→ Caller returns { status: "transient" }
→ Scheduler applies backoff → runs fresh session
→ Fresh session peeks released events
```

### 4. Transient error in `emitting` phase

```
→ updateHandlerRunStatus(runId, "paused:transient", { error })
  TX {
    handler_run.status = "paused:transient"
    Phase is post-mutation → set pending_retry_run_id = runId
    Events stay reserved
    Finalize session
    Workflow stays active
  }
→ Scheduler applies backoff → createRetryRun (transfers reservations) → retry emitting
```

### 5. Mutation applied successfully

```
Mutation tool callback detects success
→ updateMutationResult(mutationId, "success")
  TX {
    mutation.status = "applied"
    handler_run.mutation_outcome = "success"
  }
→ State machine: updateConsumerPhase(runId, "mutated") → "emitting"
→ next() runs → success
→ commitConsumer(runId)
  TX { consumeEvents(runId), status = "committed", phase = "committed" }
```

### 6. Mutation fails immediately

```
Mutation tool callback detects failure
→ updateMutationResult(mutationId, "failure")
  TX {
    mutation.status = "failed"
    handler_run.mutation_outcome = "failure"
    releaseEvents(runId)
    clear pending_retry_run_id (if set)
  }
→ State machine sees mutation_outcome = "failure"
→ updateHandlerRunStatus(runId, "failed:logic", { error })
  TX {
    handler_run.status = "failed:logic"
    mutation_outcome = "failure" → treated as pre-mutation → events already released
      (releaseEvents is idempotent — WHERE status='reserved' matches nothing)
    No pending_retry_run_id set (pre-mutation)
    finalize session
  }
→ Maintenance fixes script → fresh run → events already pending → peeks them
```

### 7. Indeterminate mutation (crash during in_flight)

```
On restart, recoverCrashedRuns() finds status='active' run in mutating phase
with in_flight mutation
→ updateHandlerRunStatus(runId, "paused:reconciliation", { error })
  TX {
    handler_run.status = "paused:reconciliation"
    Phase = mutating, mutation = in_flight → indeterminate path
    Set pending_retry_run_id = runId
    Set workflow.status = "paused"
    Events stay reserved
    finalize session
  }
→ User clicks "didn't happen":
→ updateMutationResult(mutationId, "failure", { resolved_by: "user_assert_failed" })
  TX {
    mutation.status = "failed", resolved_by = "user_assert_failed"
    handler_run.mutation_outcome = "failure"
    releaseEvents(runId)
    clear pending_retry_run_id
  }
→ User calls resumeWorkflow → workflow.status = "active"
→ Next session: fresh run peeks released events
```

### 8. Indeterminate mutation → user clicks "skip"

```
→ skipMutation(mutationId, { resolved_by: "user_skip" })
  TX {
    mutation.status = "failed", resolved_by = "user_skip"
    handler_run.mutation_outcome = "skipped"
    skipEvents(runId) — events marked "skipped"
    handler_run.phase = "committed", status = "committed"
    clear pending_retry_run_id
    increment session handler_run_count
  }
→ User calls resumeWorkflow → workflow.status = "active"
→ Events are skipped, workflow continues with next work
```

### 9. Consumer prepare returns empty reservations

```
→ updateConsumerPhase(runId, "prepared", { reservations: [] })
  TX {
    phase = "prepared"
    No events to reserve (empty reservations)
    Save prepare_result
  }
→ State machine: prepared with empty reservations → skip mutating
→ updateConsumerPhase(runId, "emitting")
→ next() runs (mutationResult = { status: "none" })
→ commitConsumer(runId)
  TX { consumeEvents(runId) — no-op (nothing reserved), status = "committed" }
```

### 10. Successful full consumer cycle

```
prepare() succeeds
→ updateConsumerPhase(runId, "prepared", { reservations: [...], prepareResult })
  TX { phase = "prepared", reserve events, save prepare_result }

→ updateConsumerPhase(runId, "mutating")
  phase = "mutating"

mutate() calls external tool → success
→ updateMutationResult(mutationId, "success")
  TX { mutation = "applied", mutation_outcome = "success" }

→ updateConsumerPhase(runId, "mutated")
  phase = "mutated"

→ updateConsumerPhase(runId, "emitting")
  phase = "emitting"

next() succeeds
→ commitConsumer(runId, { state: newState })
  TX { consumeEvents(runId), phase = "committed", status = "committed" }

Session still has work → scheduler loops → another consumer run
Session no more work → finishSession(sessionId) — marks completed
```

### 11. Crash at any point — two possible states

**State A: `status = 'active'` (crash before updateHandlerRunStatus tx committed)**
- `recoverCrashedRuns()` finds it
- Checks phase and mutation state:
  - Pre-mutation → calls `updateHandlerRunStatus(runId, "crashed", { final: true })`
    which releases events
  - Post-mutation → calls `updateHandlerRunStatus(runId, "crashed", { final: true })`
    which sets `pending_retry_run_id`
  - In-flight mutation → calls `updateHandlerRunStatus(runId, "paused:reconciliation", ...)`
    which sets `pending_retry_run_id` and pauses workflow
- All side effects happen in the same tx → consistent

**State B: `status != 'active'` (updateHandlerRunStatus tx committed)**
- Handler run, events, pending_retry_run_id, session are all consistent
- Nothing to recover — scheduler operates on consistent state

**State C: Open session, all handler runs committed**
- Session finalization (`finishSession`) didn't run before crash
- `recoverUnfinishedSessions()` finds and finalizes them on startup
- Independent of `recoverCrashedRuns()` — no ordering dependency
- Non-critical — scheduler doesn't use session state for decisions

**No crash windows exist** for the critical invariants because handler status + event
disposition + pending_retry_run_id are always in the same transaction.

### 12. Producer fails

Producers don't reserve events, so `updateHandlerRunStatus` only handles:
```
TX {
  handler_run.status = "failed:logic"
  No event disposition (producers don't reserve)
  Finalize session
  Workflow status derivation (same rules)
}
```

### 13. Auth/permission error at any phase

```
→ updateHandlerRunStatus(runId, "paused:approval", { error })
  TX {
    handler_run.status = "paused:approval"
    Pre-mutation → releaseEvents; Post-mutation → set pending_retry_run_id
    finalize session
    workflow.status = "error"
  }
→ User reconnects auth → resumeWorkflow()
→ If pre-mutation: fresh run peeks released events
→ If post-mutation: scheduler processes pending_retry_run_id → createRetryRun
```

### 14. Multiple consumers in session — first succeeds, second fails

```
Consumer A: prepare → mutate → next → commitConsumer(A)
  TX { consumeEvents(A), committed }

Consumer B: prepare → mutate → next() fails
→ updateHandlerRunStatus(B, "failed:logic", { final: true })
  TX {
    handler_run B status = "failed:logic"
    post-mutation → pending_retry_run_id = B
    finalize session
  }

→ Maintenance fixes script
→ createRetryRun(B, newSession)
  TX { create retry run, transfer reservations, clear pending_retry_run_id }
→ Retry B succeeds → commitConsumer(newB)
→ Continue consumer loop (or finish session)
```

---

## Evaluation

### Completeness check

| Scenario | Handled by |
|---|---|
| Consumer fails pre-mutation | `updateHandlerRunStatus` → releases events |
| Consumer fails post-mutation | `updateHandlerRunStatus` → sets pending_retry_run_id |
| Transient error any phase | `updateHandlerRunStatus` → same pre/post logic |
| Logic error any phase | `updateHandlerRunStatus` → same pre/post logic |
| Auth error any phase | `updateHandlerRunStatus` → same pre/post logic + workflow=error |
| Internal error | `updateHandlerRunStatus` → same pre/post logic + workflow=error |
| Mutation succeeds | `updateMutationResult(success)` → sets mutation_outcome |
| Mutation fails (immediate) | `updateMutationResult(failure)` → releases events |
| Mutation fails (reconciled) | `updateMutationResult(failure)` → releases events |
| User "didn't happen" | `updateMutationResult(failure)` → releases events |
| User "skip" | `skipMutation()` → skips events + commits run |
| Consumer committed | `commitConsumer()` → consumes events |
| Phase advance | `updateConsumerPhase()` → reserves events on prepared |
| Crash: active run | `recoverCrashedRuns()` → same pre/post logic |
| Crash: after handler tx | No recovery needed — state is consistent |
| Retry creation | `createRetryRun()` → always post-mutation, copies results + transfers reservations |
| Session end (success) | `finishSession()` — non-critical |
| Session end (failure) | `updateHandlerRunStatus` on failure/paused |
| Session end (crash recovery) | `recoverUnfinishedSessions()` — startup, after `recoverCrashedRuns()` |
| Maintenance flag set | `updateHandlerRunStatus(failed:logic)` — atomic in same tx |
| Maintenance task create | `createMaintenanceTask()` — after tx, non-critical |
| Maintenance crash recovery | `recoverMaintenanceMode()` — startup, finds flag without task |
| Maintenance exit | `exitMaintenanceMode()` — clears flag, pending_retry preserved |
| Workflow pause/resume | `pauseWorkflow()` / `resumeWorkflow()` |

### Method safety — callers can't misuse

| Dangerous action | Prevention |
|---|---|
| Calling `updateConsumerPhase("committed")` | Throws — must use `commitConsumer()` |
| Calling `updateMutationResult("skipped")` | Throws — must use `skipMutation()` |
| Forgetting event release on failure | Automatic inside `updateHandlerRunStatus` |
| Forgetting pending_retry on post-mutation failure | Automatic inside `updateHandlerRunStatus` |
| Forgetting reservation transfer on retry | Automatic inside `createRetryRun` |
| Calling `createRetryRun` on pre-mutation run | Throws — only post-mutation runs have `pending_retry_run_id` |
| Forgetting to finalize session on failure | `final: true` flag makes it atomic |
| Direct `handlerRunStore.update()` of status | Lint rule / code review — only `ExecutionModelManager` may write status |
| Direct `eventStore.releaseEvents()` | Same — only internal to `ExecutionModelManager` |

### Abstract model alignment

| Abstract invariant (Chapter 06/06b) | Enforced by |
|---|---|
| Phase only moves forward | `updateConsumerPhase` validates direction |
| Failures change status not phase | `updateHandlerRunStatus` never changes phase |
| Before mutation: can reset | `updateHandlerRunStatus` releases events |
| After mutation: must proceed forward | `updateHandlerRunStatus` sets pending_retry_run_id |
| Reserved on prepare success | `updateConsumerPhase(prepared)` reserves atomically |
| Consumed on commit | `commitConsumer()` consumes atomically |
| Mutation tracked in ledger | `updateMutationResult` updates ledger + handler_run |

### Open questions

1. **`mutation_outcome` DB migration.** Adding a column to `handler_runs` needs a migration.
   Worth the cost — makes the handler run self-contained for recovery decisions.

2. **`updateMutationResult("failure")` releases events, then `updateHandlerRunStatus` tries
   to release again.** Safe — `releaseEvents` is idempotent (`WHERE status='reserved'`).
   `updateHandlerRunStatus` sees `mutation_outcome = "failure"` and treats it as pre-mutation,
   so it won't set `pending_retry_run_id` either.

3. **Deadlock risk with `commitConsumer` calling `updateHandlerRunStatus` internally.**
   Both operate on the same tables. Since they're in one tx owned by one connection, no
   deadlock risk — SQLite serializes writes per connection. The internal call is a code path,
   not a separate connection.
