# Execution State Consolidation

> References: docs/dev/06-execution-model.md, docs/dev/06b-consumer-lifecycle.md,
> docs/dev/09-failure-repair.md, docs/dev/16-scheduling.md

## Problem Statement

The abstract execution model (Chapter 06) defines:

1. **Handler run phase** — consumer execution progress: `preparing → prepared → mutating → mutated → emitting → committed`
   Note: `mutated` means "mutate phase complete, tool outcome known" — NOT "mutation applied".
   All terminal mutation outcomes (applied, failed, skipped) land at `mutated`. `mutated → emitting`
   only proceeds if mutation didn't fail. (Requires update to docs/dev/06b to clarify.)
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
- **Workflow status** — user-controlled: `draft` / `ready` / `active` / `paused`. Only changed
  by explicit user action. The execution model NEVER touches this field.
- **Workflow error** — system-controlled: `""` (none) or error description. Set by
  `updateHandlerRunStatus` when handler needs user attention. Cleared by mutation resolution
  methods (`failMutation`, `skipMutation`, `applyMutation`). Scheduler checks:
  `status = "active" AND error = "" AND NOT maintenance`. This separation ensures user intent
  (pause/resume) is never overwritten by system state changes.
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
     Only for non-committed statuses (failure/paused/crashed):
     a. Pre-mutation: phase < mutated, or mutation_outcome = "failure"
        → releaseEvents(runId)
     b. Post-mutation: phase in (mutated, emitting) AND mutation_outcome != "failure"
        → set workflow.pending_retry_run_id = runId
        → events stay reserved
     c. Indeterminate: phase = mutating AND mutation in_flight/needs_reconcile/indeterminate
        → set workflow.pending_retry_run_id = runId
        → set workflow.error (mutation outcome uncertain)
        → events stay reserved

  3. Session finalization (only on failure/paused/crashed — NOT on committed):
     → finalize script_run (via handler_run.script_run_id) with result="failed", aggregated cost, error
     Handler failure always ends the session. Committed runs don't — the scheduler
     may run more consumers in the same session.

  4. Maintenance flag (only for failed:logic):
     - failed:logic → set workflow.maintenance = true
     Atomic with the rest — no crash window between failure and maintenance flag.
     Maintainer task creation happens AFTER the tx (external operation).
     If crash before task creation: startup recovery finds maintenance=true with
     no active maintainer task → creates one (see recoverMaintenanceMode).

  5. Workflow error (only on statuses that need user attention — NOT on committed/transient/logic):
     - paused:approval → set workflow.error (e.g. "Authentication required")
     - paused:reconciliation → set workflow.error (e.g. "Mutation outcome uncertain")
     - failed:internal → set workflow.error (e.g. "Internal error")
     - failed:logic → no error (maintenance flag handles it)
     - paused:transient → no error (retry handles it)
     - crashed → no error (crash recovery handles it)
     Never touches workflow.status — that is user-controlled (see design note below).
}
```

**Valid statuses:** `paused:transient`, `paused:approval`, `paused:reconciliation`, `failed:logic`,
`failed:internal`, `committed`, `crashed`. The `crashed` status follows the same pre/post-mutation
logic as other non-committed statuses — it's just a different label for observability.

**Who calls it:**
- Handler state machine on any error (replaces `failRun`, `pauseRun`, `pauseRunForIndeterminate`)
- Handler state machine after `failMutation()` for active runs (mutation resolved, then status set)
- Crash recovery (with `crashed` status — including active runs with terminal mutations)
- Internally by `commitConsumer()` and `commitProducer()` for the committed path

For the success path where the session has no more work, session finalization is handled
separately by `finishSession()`.

---

### Method 2: `updateConsumerPhase(runId, newPhase, opts?)`

Called when consumer advances to next phase. Phase-specific side effects are atomic.

```
Phase-specific behavior:

  pending → preparing:
    Update phase = "preparing"

  preparing → prepared:
    TRANSACTION {
      Update phase = "prepared"
      reserveEvents(runId, opts.reservations)
      Save prepare_result (reservations, data)
      Save wakeAt to handler state if provided
    }
    opts must include: reservations, prepareResult, wakeAt?

  prepared → mutating:
    Update phase = "mutating"
    Guard: reservations must be non-empty (no mutation without events to process)

  prepared → emitting:
    Update phase = "emitting"
    (Used when prepare returns empty reservations or script has no mutate.
    No special handling needed — mutation_outcome stays "" which is treated
    as pre-mutation by updateHandlerRunStatus, so failures release events
    correctly. "emitting" phase here is safe to reset.)

  mutating → mutated:
    Update phase = "mutated"
    Means "mutate phase complete, tool outcome known" — set for ALL terminal
    mutation outcomes (applied, failed, skipped), not just "applied".
    May be called on non-active runs (e.g. paused:reconciliation) when
    mutation outcome is resolved by reconciliation or user action.

  mutated → emitting:
    Update phase = "emitting"
    Only valid when mutation_outcome != "failure" (applied, skipped, or "").
```

**Throws if `newPhase = "committed"`.** Use `commitConsumer()` instead (see below).
**Validates phase ordering** — new phase must be strictly later than current phase.

**`preparing → prepared` is the only phase transition with event side effects** (reservation).
All other non-terminal transitions are pure phase updates.

---

### Method 3: `commitConsumer(runId, opts?)`

Dedicated method for the `→ committed` transition. Internally calls `updateHandlerRunStatus`
in the same transaction.

```
TRANSACTION {
  consumeEvents(runId)
  Update handler persistent state (handlerStateStore) if opts.state provided
  Update handler_run.output_state if opts.state provided
  Update phase = "committed"
  Update status = "committed" via updateHandlerRunStatus logic
  Increment session handler_run_count
}
```

opts must include: state? (handler persistent state from next() return value)

**Why separate from `updateConsumerPhase`?** `committed` is fundamentally different — it touches
events (consumed), status (committed), state, and session (count). Bundling it prevents callers
from forgetting the status update. The `updateConsumerPhase` method throws on "committed" to
prevent misuse.

---

### Method 4: `commitProducer(runId, opts?)`

Dedicated commit method for producer handler runs. Producers don't reserve/consume events
or have mutations, but do have persistent state and schedule updates.

```
TRANSACTION {
  Update handler persistent state (handlerStateStore) if opts.state provided
  Update handler_run.output_state if opts.state provided
  Update phase = "committed"
  Update status = "committed" via updateHandlerRunStatus logic
  Update producer schedule (next_run_at) via producerScheduleStore
  Increment session handler_run_count
}
```

opts must include: state? (handler persistent state), producerScheduleUpdate? (next_run_at)

**Why separate from `commitConsumer`?** Producers have no event operations but DO have
schedule updates. Separate methods prevent callers from accidentally using the wrong one
and missing schedule updates or attempting event operations on producers.

---

### Method 5: `applyMutation(mutationId, opts?)`

Called when a mutation succeeds. Bundles mutation outcome with phase advance atomically.

```
TRANSACTION {
  mutation.status = "applied"
  mutation.result = opts.result (serialized)
  handler_run.mutation_outcome = "success"
  updateConsumerPhase(runId, "mutated") — internally, same tx
  clear workflow.error (if set — mutation resolved, no longer needs attention)
}
```

**Why bundle phase advance?** Symmetric with `failMutation` which bundles mutation + handler
termination. Without bundling, crash between `applyMutation` and `updateConsumerPhase(mutated)`
leaves mutation applied but phase stuck at mutating — recovery works (mutation_outcome is the
source of truth) but is awkward. Bundling eliminates the crash window.

Phase advance goes through `updateConsumerPhase` internally — single source of truth for all
non-terminal phase transitions. If phase-specific side effects are ever added to the
`mutating → mutated` transition, they're automatically triggered.

After this returns, the handler state machine continues from mutated → emitting → next.

**Note:** `updateConsumerPhase(mutated)` is still valid as a standalone call for the "no
mutation tool called" case where the script's mutate function runs but doesn't call any
mutation tool.

**Input validation:** Accepts mutations in any non-terminal status (`in_flight`,
`needs_reconcile`). Throws if mutation is already terminal (`applied`, `failed`,
`indeterminate`).

**Who calls it:**
- Tool wrapper on successful mutation execution
- Reconciliation scheduler on confirmed success
- User UI: "assert applied" click

---

### Method 6: `failMutation(mutationId, opts?)`

Called when a mutation definitively fails. Resolves the mutation and releases events.
Does NOT touch handler run status — that's orthogonal (caller uses `updateHandlerRunStatus`).

Symmetric with `applyMutation` and `skipMutation`: all three are mutation-phase methods
that advance to `mutated` and handle mutation-specific side effects. Run status is never
their concern.

```
TRANSACTION {
  mutation.status = "failed" (+ resolved_by, resolved_at if provided)
  handler_run.mutation_outcome = "failure"
  updateConsumerPhase(runId, "mutated") — internally, same tx (mutate phase complete)
  releaseEvents(runId)
  clear workflow.pending_retry_run_id (if set)
  clear workflow.error (if set — mutation resolved, no longer needs attention)
}
```

opts: `resolved_by?: string`, `resolved_at?: number` (for reconciliation/user resolution).

**Why release events here?** Mutation failure means the events weren't processed —
releasing them is a mutation-phase concern (the mutation outcome determines event
disposition), not a run-status concern. Same reason `skipMutation` skips events.

**Caller flow (active run — tool wrapper detects definite failure):**
1. `failMutation(mutationId)` — resolves mutation, releases events, clears error
2. Error propagates up to handler state machine
3. Handler state machine classifies error, calls `updateHandlerRunStatus(runId, derivedStatus)`
   (existing error→status logic in `failure-handling.ts`, unchanged)

**Caller flow (terminal run — reconciliation/user resolution):**
1. `failMutation(mutationId, { resolved_by })` — resolves mutation, releases events, clears error
2. Run is already terminal — no `updateHandlerRunStatus` needed
3. Scheduler sees `workflow.status="active"`, `error=""`, `!maintenance` → proceeds

**Crash window (active run):** If crash between `failMutation` TX and `updateHandlerRunStatus`:
run is active + phase=mutated + mutation_outcome="failure". `recoverCrashedRuns()` finds it,
calls `updateHandlerRunStatus(crashed)` which sees mutation_outcome="failure" → treats as
pre-mutation (rule 2a) → releaseEvents (no-op, already released) → marks crashed, finalizes
session. Clean recovery, no orphaned state.

**Input validation:** Accepts mutations in any non-terminal status (`in_flight`,
`needs_reconcile`). Also accepts `indeterminate` (user resolution). Throws if mutation is
already terminal (`applied`, `failed`).

**Who calls it:**
- Tool wrapper on definite failure (run is active — caller handles status separately)
- Reconciliation scheduler on confirmed failure (run is paused — just resolves mutation)
- User UI: "didn't happen" click (run is paused — just resolves mutation)

---

### Method 7: `skipMutation(mutationId, opts?)`

Dedicated method for user "skip" action. Resolves the mutation and sets up state for
`next()` to run via the retry path.

```
TRANSACTION {
  mutation.status = "failed", resolved_by = "user_skip"
  handler_run.mutation_outcome = "skipped"
  updateConsumerPhase(runId, "mutated") — internally, same tx (mutate phase complete)
  skipEvents(runId) — events marked "skipped" (terminal for those events)
  set workflow.pending_retry_run_id = runId (if not already set)
  clear workflow.error (mutation resolved, no longer needs attention)
}
```

After skip, the handler run is at phase=`mutated`, status=`paused:reconciliation`.
`mutated` correctly reflects "mutate phase complete, outcome known".

The scheduler (when workflow is active and error is clear) processes `pending_retry_run_id`:
1. `createRetryRun` → new run at `emitting` phase, copies prepare_result + mutation_outcome
2. `transferReservations` → no-op (events already skipped, safe)
3. Retry executes `next()` with `mutationResult = { status: "skipped" }`
4. `commitConsumer` → `consumeEvents` no-op (nothing reserved), committed

**Why not commit immediately?** The abstract model requires `next()` to always execute —
it updates consumer state and may produce further events. `skipMutation` resolves the
mutation and events, but `next()` still needs to run. The retry path handles this.

---

### Method 8: `createRetryRun(failedRunId, sessionId, opts?)`

Called by scheduler when processing `pending_retry_run_id`.

**Invariant: only called for post-mutation runs.** `pending_retry_run_id` is only set by
`updateHandlerRunStatus` for post-mutation failures (phase >= mutated, mutation_outcome != "failure")
or indeterminate mutations resolved via `skipMutation`. Pre-mutation failures release events and
never set `pending_retry_run_id`. Throws if the failed run is pre-mutation — guards against caller
misuse. Single-threaded scheduler means no races, just a programming error if this fires.

```
TRANSACTION {
  Assert failed run is post-mutation (throw otherwise)
  Create new handler_run (retry_of = failedRunId, phase = "emitting")
  Copy prepare_result, mutation_result, and mutation_outcome from failed run
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

### Method 9: `finishSession(sessionId)`

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

**`pauseWorkflow(workflowId)`** — user clicks pause. Sets `workflow.status = "paused"`.
Does NOT touch handler runs, events, mutations, or workflow.error.

**`resumeWorkflow(workflowId)`** — user clicks resume. Sets `workflow.status = "active"`.
Does NOT touch handler runs, events, mutations, or workflow.error.
If `workflow.error` is set, the scheduler still won't run — user must resolve the error first.

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

### `updateMutationStatus(mutationId, newStatus, opts?)`

Thin wrapper for non-terminal mutation state transitions. No side effects on handler runs,
events, or workflow — just updates the mutation record.

```
Valid transitions:
  pending → in_flight    (tool wrapper, before external call)
  in_flight → needs_reconcile  (uncertain outcome, tool supports reconciliation)
  in_flight → indeterminate  (uncertain outcome, tool has no reconciliation method)
  needs_reconcile → indeterminate  (reconciliation exhausted, escalate to user)
```

opts may include: error, tool info (namespace, method, params), reconciliation scheduling
metadata (next_reconcile_at, reconcile_attempts).

**Why in ExecutionModelManager?** For completeness — all mutation state changes live in one
file. But these transitions are simple status updates with no cascading effects. The
scheduler doesn't care about these states. Only terminal outcomes (`applyMutation`,
`failMutation`, `skipMutation`) trigger side effects on controlled variables.

These transitions may happen during an active run (`in_flight → indeterminate` when tool
has no reconciliation) or after the run is already paused (`needs_reconcile → indeterminate`
when reconciliation is exhausted). Either way, `updateMutationStatus` is just a label change.
The error propagates to the handler state machine which calls `updateHandlerRunStatus`
separately to handle run status, session, and workflow effects.

---

### Event operations (internal, not public API)

These are called only by the methods above, never directly by external code:

- `reserveEvents(runId, reservations)` — called by `updateConsumerPhase(prepared)`
- `consumeEvents(runId)` — called by `commitConsumer()`
- `releaseEvents(runId)` — called by `updateHandlerRunStatus` (pre-mutation) and `failMutation()`
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
→ applyMutation(mutationId, { result })
  TX {
    mutation.status = "applied", mutation.result = result
    handler_run.mutation_outcome = "success"
    updateConsumerPhase(mutated) internally → phase = "mutated"
  }
→ State machine: updateConsumerPhase(runId, "emitting")
→ next() runs → success
→ commitConsumer(runId, { state })
  TX { consumeEvents(runId), state saved, status = "committed", phase = "committed" }
```

### 6. Mutation fails immediately (definite failure)

```
Mutation tool callback detects definite failure (e.g. LogicError from connector)
→ failMutation(mutationId)
  TX {
    mutation.status = "failed"
    handler_run.mutation_outcome = "failure"
    updateConsumerPhase(mutated) internally → phase = "mutated"
    releaseEvents(runId)
    clear pending_retry_run_id (if set)
    clear workflow.error (if set)
  }
→ Error propagates up to handler state machine
→ Handler classifies error, calls updateHandlerRunStatus(runId, derivedStatus)
  TX {
    handler_run.status = derived (e.g. "failed:logic")
    mutation_outcome = "failure" → pre-mutation path → releaseEvents (no-op)
    finalize session, maintenance flag if failed:logic, workflow.error if needed
  }
→ If failed:logic: scheduler calls createMaintenanceTask()
→ If paused:transient: scheduler applies backoff → fresh run
→ Events already released → pending → fresh run peeks them
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
    Set workflow.error = "Mutation outcome uncertain"
    Events stay reserved
    finalize session
  }
→ User clicks "didn't happen":
→ failMutation(mutationId, { resolved_by: "user_assert_failed" })
  TX {
    mutation.status = "failed", resolved_by = "user_assert_failed"
    handler_run.mutation_outcome = "failure"
    updateConsumerPhase(mutated) internally → phase = "mutated"
    releaseEvents(runId)
    clear pending_retry_run_id
    clear workflow.error
  }
→ If workflow.status = "active": scheduler proceeds with fresh session
→ If workflow.status = "paused" (user paused separately): waits until user resumes
→ Next session: fresh run peeks released events
```

### 8. Indeterminate mutation → user clicks "skip"

```
→ skipMutation(mutationId, { resolved_by: "user_skip" })
  TX {
    mutation.status = "failed", resolved_by = "user_skip"
    handler_run.mutation_outcome = "skipped"
    updateConsumerPhase(mutated) internally → phase = "mutated"
    skipEvents(runId) — events marked "skipped"
    set pending_retry_run_id = runId (if not already set)
    clear workflow.error
  }
→ If workflow.status = "active": scheduler proceeds
→ Scheduler sees pending_retry_run_id → createRetryRun
  TX {
    New run at emitting, copies prepare_result + mutation_outcome("skipped")
    transferReservations → no-op (events already skipped)
    Clear pending_retry_run_id
  }
→ Retry executes next() with mutationResult = { status: "skipped" }
→ commitConsumer → consumeEvents no-op, committed
```

### 9. Consumer prepare returns empty reservations

```
→ updateConsumerPhase(runId, "prepared", { reservations: [], prepareResult })
  TX {
    phase = "prepared"
    No events to reserve (empty reservations)
    Save prepare_result
  }
→ State machine: prepared with empty reservations → skip mutating
→ updateConsumerPhase(runId, "emitting")
  phase = "emitting" (no mutation, mutation_outcome stays "")
→ next() runs (mutationResult = { status: "none" })
  next() MUST run even with empty reservations — it updates consumer state
  and may produce further events
→ commitConsumer(runId, { state })
  TX { consumeEvents(runId) — no-op (nothing reserved), state saved, committed }
```

### 10. Successful full consumer cycle

```
prepare() succeeds
→ updateConsumerPhase(runId, "prepared", { reservations: [...], prepareResult, wakeAt? })
  TX { phase = "prepared", reserve events, save prepare_result, save wakeAt }

→ updateConsumerPhase(runId, "mutating")
  phase = "mutating"

mutate() calls external tool → success
→ applyMutation(mutationId, { result })
  TX { mutation = "applied", mutation_outcome = "success", updateConsumerPhase(mutated) }

→ updateConsumerPhase(runId, "emitting")
  phase = "emitting"

next() succeeds
→ commitConsumer(runId, { state: newState })
  TX { consumeEvents(runId), state saved, phase = "committed", status = "committed" }

Session still has work → scheduler loops → another consumer run
Session no more work → finishSession(sessionId) — marks completed
```

### 11. Crash at any point — two possible states

**State A: `status = 'active'` (crash before updateHandlerRunStatus tx committed)**
- `recoverCrashedRuns()` finds it
- Checks phase and mutation state — three paths:
  - **Pre-mutation** (phase < mutating, or phase = mutating with no in_flight mutation):
    → `updateHandlerRunStatus(runId, "crashed")` → releases events
  - **In-flight mutation** (phase = mutating with in_flight/needs_reconcile mutation):
    → `updateHandlerRunStatus(runId, "paused:reconciliation")` → sets
    `pending_retry_run_id`, sets `workflow.error`
  - **Post-mutation** (phase >= mutated, or mutation_outcome = "success"):
    → `updateHandlerRunStatus(runId, "crashed")` → sets `pending_retry_run_id`
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

### 12. Producer succeeds

```
Producer handler completes successfully
→ commitProducer(runId, { state: newState, producerScheduleUpdate })
  TX {
    state saved (handlerStateStore + output_state)
    phase = "committed", status = "committed"
    producer schedule next_run_at updated
    increment session handler_run_count
  }
```

### 13. Producer fails

Producers don't reserve events, so `updateHandlerRunStatus` only handles:
```
TX {
  handler_run.status = "failed:logic"
  No event disposition (producers don't reserve)
  Finalize session
  Workflow status derivation (same rules)
  Maintenance flag if logic error
}
```

### 14. Auth/permission error at any phase

```
→ updateHandlerRunStatus(runId, "paused:approval", { error })
  TX {
    handler_run.status = "paused:approval"
    Pre-mutation → releaseEvents; Post-mutation → set pending_retry_run_id
    finalize session
    workflow.error = "Authentication required"
  }
→ User reconnects auth → system clears workflow.error
→ If workflow.status = "active": scheduler proceeds
→ If pre-mutation: fresh run peeks released events
→ If post-mutation: scheduler processes pending_retry_run_id → createRetryRun
```

### 15. Multiple consumers in session — first succeeds, second fails

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
| Mutation succeeds | `applyMutation()` → sets mutation_outcome |
| Mutation fails (definite, active run) | `failMutation()` → releases events; caller calls `updateHandlerRunStatus` |
| Mutation fails (reconciled, terminal run) | `failMutation()` → releases events, clears error |
| User "didn't happen" | `failMutation()` → releases events, clears error |
| User "skip" | `skipMutation()` → skips events, phase=mutated, clears error, leaves for retry |
| Consumer committed | `commitConsumer()` → consumes events, saves state |
| Producer committed | `commitProducer()` → saves state, updates schedule |
| Phase advance | `updateConsumerPhase()` → reserves events on prepared |
| Crash: active run | `recoverCrashedRuns()` → same pre/post logic |
| Crash: active run + terminal mutation | `recoverCrashedRuns()` → mutation_outcome drives pre/post logic (no-op releases) |
| Crash: after handler tx | No recovery needed — state is consistent |
| Retry creation | `createRetryRun()` → always post-mutation, copies results + transfers reservations |
| Session end (success) | `finishSession()` — non-critical |
| Session end (failure) | `updateHandlerRunStatus` on failure/paused |
| Session end (crash recovery) | `recoverUnfinishedSessions()` — startup, independent of `recoverCrashedRuns()` |
| Maintenance flag set | `updateHandlerRunStatus(failed:logic)` — atomic in same tx |
| Maintenance task create | `createMaintenanceTask()` — after tx, non-critical |
| Maintenance crash recovery | `recoverMaintenanceMode()` — startup, finds flag without task |
| Maintenance exit | `exitMaintenanceMode()` — clears flag, pending_retry preserved |
| Workflow pause/resume (user) | `pauseWorkflow()` / `resumeWorkflow()` — only touch status |
| Workflow error (system) | `updateHandlerRunStatus` sets, mutation methods clear |

### Method safety — callers can't misuse

| Dangerous action | Prevention |
|---|---|
| Calling `updateConsumerPhase("committed")` | Throws — must use `commitConsumer()` |
| Forgetting event release on mutation failure | Automatic inside `failMutation()` |
| Forgetting pending_retry on post-mutation failure | Automatic inside `updateHandlerRunStatus` |
| Forgetting reservation transfer on retry | Automatic inside `createRetryRun` |
| Calling `createRetryRun` on pre-mutation run | Throws — only post-mutation runs have `pending_retry_run_id` |
| Forgetting to finalize session on failure | Automatic inside `updateHandlerRunStatus` for failure/paused |
| Forgetting producer schedule update on commit | Automatic inside `commitProducer()` |
| Using `commitConsumer` for producers (or vice versa) | Separate methods prevent cross-use |
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
| Mutation tracked in ledger | `applyMutation` / `failMutation` / `skipMutation` update ledger + handler_run |
| next() always executes | `skipMutation` leaves for retry, `commitConsumer` only after next() |

### Open questions

1. **Deadlock risk with `commitConsumer` calling `updateHandlerRunStatus` internally.**
   Both operate on the same tables. Since they're in one tx owned by one connection, no
   deadlock risk — SQLite serializes writes per connection. The internal call is a code path,
   not a separate connection.

2. **Intermediate mutation states live in `updateMutationStatus` for completeness.**
   `in_flight`, `needs_reconcile`, `indeterminate` are simple status updates — no side effects
   on handler runs, events, or workflow. They live in ExecutionModelManager only so all mutation
   state changes are in one file. The scheduler doesn't care about these states. Only terminal
   outcomes (`applyMutation`, `failMutation`, `skipMutation`) trigger cascading side effects.

---

### TODO (implementation phase)

1. **`mutation_outcome` DB migration.** Add column to `handler_runs`, default `""`. For existing
   runs: if `phase >= mutated` and `mutation_outcome == ""`, treat as `"success"` in recovery logic
   (the mutation was applied, that's why the phase advanced).

2. **Handler run creation sites.** Collect all places that create handler_run records (initial runs,
   retry runs, etc.) and add creation methods to `ExecutionModelManager`. Currently scattered
   across session-orchestration.ts and handler-state-machine.ts.

3. **Method opts type definitions.** Define TypeScript interfaces for all opts parameters during
   implementation planning phase.

4. **Update docs/dev/06b.** Clarify that `mutated` phase means "mutate phase complete, tool
   outcome known" — not "mutation applied". All terminal mutation outcomes (applied, failed,
   skipped) land at `mutated`.

5. **Workflow status/error field split.** Add `workflow.error` column (string, default "").
   Migrate existing `workflow.status = "error"` to `workflow.error = "..."` + `workflow.status = "active"`.
   Remove system-controlled status changes from execution model code.

6. **Transaction context passing.** Methods that call other methods internally (e.g.
   `applyMutation` calling `updateConsumerPhase`) share a transaction context via `tx` parameter.
   Not nested transactions — single shared tx.

