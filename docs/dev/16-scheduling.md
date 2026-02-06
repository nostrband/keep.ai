# 16. Scheduling

This chapter defines when and how handlers of the execution model are invoked by the host runtime.

---

## Principles

1. **Host-controlled** — the host decides when to run handlers; scripts do not control their own scheduling
2. **Simple and predictable** — users can understand when their workflow will run
3. **No busy-looping** — the system must not waste resources polling when there's nothing to do
4. **Responsive** — new work should be processed promptly

---

## Producer Scheduling

Producers poll external systems for new data. They run on a **configured schedule**.

### Schedule Types

* **Interval** — run every N minutes (e.g., every 5 minutes)
* **Cron** — run on cron schedule (e.g., "0 * * * *" for hourly)

### Trigger Conditions

A producer run starts when:

1. Schedule fires, AND
2. No other run (producer or consumer) is active for this workflow

If a scheduled time arrives while another run is active, the producer run is queued. Queued runs are coalesced (at most one pending). This ensures producers aren't silently skipped due to long-running consumers or crashes.

### Manual Trigger

Users can manually trigger producers from the UI ("Run now"). This:

* **Rejected if any run is active** — user must wait for current run to complete
* **Queues all producers** — they run sequentially, respecting single-threaded execution
* **Updates each producer's `next_run_at`** — after each runs, its next scheduled time is recomputed

Consumers are not directly triggered by "Run now" — they run naturally when producers publish new events.

### Configuration

```js
producers: {
  pollEmail: {
    schedule: { interval: "5m" },  // or { cron: "*/5 * * * *" }
    handler: async (ctx, state) => { ... }
  }
}
```

---

## Consumer Scheduling

Consumers process events from topics. They run **when there is work to do**.

### Trigger Conditions

A consumer run starts when:

1. No other run (producer or consumer) is active for this workflow, AND
2. At least one of:
   * New event has arrived in a subscribed topic since last run
   * Scheduled wake time (`wakeAt`) has been reached

If a trigger fires while another run is active, the consumer run is queued. Queued runs are coalesced (at most one pending).

### The Empty Reservation Problem

A consumer's `prepare` phase may return empty reservations even when pending events exist:

* Waiting for correlated events across topics
* Waiting for a time window
* Filtering events by criteria not yet met
* Batching threshold not reached

If the host immediately retries, it creates a busy-loop. The consumer must wait for a trigger (new event or `wakeAt`).

### The wakeAt Hint

For time-based patterns (daily digests, delayed processing, batch timeouts), scripts can request a specific wake time:

```ts
// In PrepareResult
{
  reservations: [...],  // may be empty or non-empty
  data: {},
  wakeAt?: string  // ISO 8601 datetime, e.g., "2024-01-15T09:00:00Z"
}
```

**Semantics:**

* `wakeAt` is optional — omit it for purely event-driven consumers
* `wakeAt` is always recorded when provided, regardless of whether reservations are empty or non-empty
* Consumer wakes at the specified time OR on new event, whichever comes first
* New events always wake the consumer — if it's not the right time yet, script can return empty reservations with updated `wakeAt`

**Why allow wakeAt with non-empty reservations?**

A daily digest consumer at 9am processes today's events and needs to schedule tomorrow's run. It doesn't know if new events will arrive before then, so it must set `wakeAt` even when returning non-empty reservations:

```ts
async prepare(ctx, state) {
  const pending = await ctx.peek("notifications");
  const tomorrow9am = getNextDigestTime();

  if (!isDigestTime()) {
    // Not time yet — sleep until digest time
    return { reservations: [], data: {}, wakeAt: tomorrow9am };
  }

  // It's digest time — process and schedule next
  return {
    reservations: [{ topic: "notifications", ids: pending.map(e => e.id) }],
    data: { items: pending },
    wakeAt: tomorrow9am  // Schedule next digest even though we're processing now
  };
}
```

**Host-enforced constraints** (prevents abuse by untrusted scripts):

| Constraint | Policy | Rationale |
|------------|--------|-----------|
| Minimum interval | `wakeAt >= now + minWakeInterval` (e.g., 30s) | Prevents busy-looping |
| Maximum interval | `wakeAt <= now + maxWakeInterval` (e.g., 24h) | Prevents unbounded sleep |
| Invalid values | Clamped to valid range | Graceful handling of script errors |

These limits are host policy (see Chapter 15), not script-controlled.

### Pattern Coverage

| Pattern | wakeAt | Wake Trigger | Notes |
|---------|--------|--------------|-------|
| Simple FIFO | — | New event | Always processes immediately (non-empty reservations) |
| Correlation | — | New event | Waits until correlated event arrives |
| Time window | `now + 1h` | wakeAt | Processes after delay |
| Batch + timeout | `now + 1h` | New event or wakeAt | Whichever threshold hits first |
| Daily digest | `tomorrow 9am` | wakeAt (+ events*) | *Events wake but return empty until 9am |

### Why This Design?

**Event-driven patterns** (correlation, batching by count) need only "wake on new event" — no polling, minimal latency.

**Time-based patterns** (scheduled processing, timeouts) use `wakeAt` for precise timing instead of polling every N minutes.

**Script hints are safe** because:

* Host enforces minimum/maximum bounds
* New events always wake regardless of `wakeAt` (responsiveness preserved)
* Worst case for malicious script: extra prepare calls (which are side-effect-free)

---

## Scheduler State

The scheduler maintains state to decide when handlers should run. Some state must be persisted (survives restarts), while other state can be kept in memory (recoverable from persisted data).

### Persisted State

Must survive restarts — stored in database:

| State | Handler | Purpose |
|-------|---------|---------|
| `next_run_at` | Producer | Next scheduled time; detects missed schedules on restart |
| `wakeAt` | Consumer | From PrepareResult; resumes time-based scheduling |
| `state` | Both | Handler's own state (cursors, checkpoints) |

### In-Memory State

Can be lost on restart — recovered by querying persisted data:

| State | Handler | Purpose | Recovery |
|-------|---------|---------|----------|
| `dirty` | Consumer | New events arrived since last run | Query pending events in subscribed topics |
| `queued` | Both | Trigger fired during active run | Check if `now >= next_run_at` (producers) or pending events exist (consumers) |

**Why in-memory?** These flags change frequently (every event publish, every schedule tick). Persisting them would add write overhead for state that's easily recoverable.

### Scheduler Logic

```
On producer schedule fire:
  If workflow idle: start producer run
  Else: set producer.queued = true

On event publish to topic T:
  For each idle consumer subscribed to T:
    Set dirty = true
  If consumer not idle:
    Set consumer.queued = true

On scheduler tick:
  Start producer run if:
    Workflow is idle, AND
    (now >= next_run_at OR queued = true)

  Start consumer run if:
    Workflow is idle, AND
    (dirty = true OR queued = true OR (wakeAt != null AND now >= wakeAt))

On run commit:
  Set handler.queued = false
  For producers: compute and store next_run_at
  For consumers: set dirty = false, set wakeAt from PrepareResult
```

### Initial State (on deploy)

* Producer `next_run_at` = now → runs immediately
* Consumer `dirty` = true → runs prepare immediately

This ensures immediate activity on deploy. If a handler needs time-based constraints (e.g., "only at 9am"), the script checks conditions and returns empty reservations.

### Restart Recovery

On restart, in-memory flags are lost. The scheduler recovers:

1. For each producer: if `now >= next_run_at` → set `queued = true`
2. For each consumer: if pending events exist in subscribed topics → set `dirty = true`

This may cause one extra run per handler — safe because handlers are idempotent (producers deduplicate by messageId, consumers reserve before mutation).

---

## Run Management

This section defines how runs are tracked, how failures are handled, and when phase resets occur. This is the implementation of the abstract execution model (Chapter 06).

### Run Records

Each execution attempt is stored as a separate **run record**. This preserves full history for observability and debugging.

```
runs:
  - id                  -- unique identifier
  - workflow_id
  - handler_id          -- which producer/consumer
  - handler_type        -- 'producer' | 'consumer'
  - retry_of            -- links to previous attempt (nullable)
  - phase               -- preparing | prepared | mutating | mutated | emitting | committed
  - status              -- see Run Status below
  - prepare_result      -- checkpointed (or copied from retry_of if mutation applied)
  - mutation_result     -- checkpointed (or copied from retry_of if mutation applied)
  - error_details       -- if failed
  - created_at
  - updated_at
```

**Key properties:**

* One record per attempt (not updated across retries)
* `retry_of` links attempts into a chain for traceability
* Phase and status preserved at time of completion/failure
* If mutation was applied and we're retrying `next`, new run copies `prepare_result` and `mutation_result` from the previous run

### Run Status

Run status is **orthogonal to execution phase** (see Chapter 06b). A run can be paused at any phase.

| Status | Meaning | Resolution |
|--------|---------|------------|
| `active` | Currently executing | — |
| `paused:transient` | Transient failure, will retry | Backoff then new run |
| `paused:approval` | Waiting for user approval | User approves/rejects |
| `paused:reconciliation` | Uncertain mutation outcome | Reconciliation or user action |
| `failed:logic` | Script error, auto-fix eligible | Auto-fix then new run |
| `failed:internal` | Host/connector bug | Contact support, workflow paused |
| `committed` | Successfully completed | — |
| `crashed` | Found incomplete on restart | Recovery creates new run |

**Critical invariant:** Status changes do not change phase. Phase only advances forward on successful completion of each phase.

### Phase States

Consumer runs progress through these phases (see Chapter 06b for full diagram):

```
preparing → prepared → mutating → mutated → emitting → committed
```

**Phase transitions and checkpoints:**

| Transition | When | What's persisted |
|------------|------|------------------|
| → `prepared` | prepare succeeds | PrepareResult (reservations, data, wakeAt) |
| → `mutated` | mutation applied | Mutation result (atomically with phase) |
| → `committed` | next succeeds | State, event consumption marks |

The `mutated` phase is set **atomically** with the mutation result. This makes it easy to determine if mutation was applied: check `phase >= mutated`.

### Phase Reset Rules

The execution model (Chapter 06) permits phase reset before mutation is applied. The scheduler implements this aggressively for simplicity and robustness:

| Current Phase | Mutation Applied? | Action |
|---------------|-------------------|--------|
| `preparing` | No | New run starts fresh from `preparing` |
| `prepared` | No | New run starts fresh from `preparing` |
| `mutating` | No | New run starts fresh from `preparing` |
| `mutated` | **Yes** | New run copies results, starts at `emitting` |
| `emitting` | **Yes** | New run copies results, retries `emitting` |

**How do we know if mutation was applied?** Check the phase. If `phase >= mutated`, mutation was applied. The mutation result is stored with the run record and copied to retry runs.

**Why aggressive reset?** Starting fresh gives auto-fix a clean slate. The only exception is after mutation — then we must proceed forward with the existing results.

### Failure Classification and Handling

| Failure Type | Status | Phase Reset? | Next Action |
|--------------|--------|--------------|-------------|
| Transient (rate limit, timeout) | `paused:transient` | Per rules above | Backoff → new run |
| Logic error (script throws, bad input) | `failed:logic` | Per rules above | Auto-fix → new run |
| Auth failure (token expired) | `paused:approval` | No | User re-auths → resume |
| Permission denied | `paused:approval` | No | User grants → resume |
| Mutation indeterminate | `paused:reconciliation` | No | Reconcile → resume |
| Internal error (our bug) | `failed:internal` | No | Contact support |

**Transient vs Logic errors:**

* Transient: Expected to resolve without code changes. Retry same code.
* Logic: Code is wrong. Auto-fix produces new code, then retry.

Both may trigger phase reset (before mutation). The difference is whether auto-fix runs.

### Retry Flow

**Transient failure (e.g., rate limit in prepare):**

1. Run A: `phase=preparing`, `status=paused:transient`
2. Backoff delay
3. New Run B: `retry_of=A`, starts fresh from `preparing`
4. Run B succeeds: `phase=committed`, `status=committed`

**Logic error with auto-fix (e.g., script throws in prepare):**

1. Run A: `phase=preparing`, `status=failed:logic`
2. Auto-fix produces new script version
3. New Run B: `retry_of=A`, starts fresh from `preparing` (with new script)
4. Run B succeeds or fails again (budget limits apply)

**Failure after mutation applied (e.g., error in next):**

1. Run A: mutation succeeds, `phase=mutated`, then `next` throws, `phase=emitting`, `status=failed:logic`
2. Auto-fix produces new script version
3. New Run B: `retry_of=A`, copies `prepare_result` and `mutation_result` from A
4. Run B starts at `emitting` phase (cannot reset — `phase >= mutated` means mutation happened)
5. Run B's `next` executes with same inputs

### Restart Recovery

On host restart, incomplete runs are detected and recovered:

1. Find runs with `status=active` → mark as `status=crashed`
2. For each crashed run, create recovery run with `retry_of` pointing to it
3. Recovery run applies phase reset rules:
   * If mutation not applied → start fresh from `preparing`
   * If mutation applied but outcome uncertain → enter reconciliation
   * If mutation applied and confirmed → start at `emitting`

This ensures no runs are silently lost and all state is preserved for debugging.

---

## Workflow-Level Constraints

### Single-Threaded Execution

From Chapter 06: at most one run is active per workflow at any time.

The scheduler enforces this:

* If producer schedule fires during an active run → queue (run after current completes)
* If consumer trigger fires during an active run → queue (run after current completes)
* Queued runs are coalesced per handler (at most one pending run per producer/consumer)

### Priority

When a run completes and multiple triggers are pending:

1. Consumer runs take priority over producer runs (process existing work before ingesting more)
2. Among consumers, the one with oldest pending events runs first

### Paused Workflows

When a workflow is paused, no scheduled runs occur and "Run now" is disabled.

How pause resolves depends on the cause:

| Status | Resolution |
|--------|------------|
| `paused:transient` | Host auto-retries after backoff |
| `paused:approval` | User grants permission or re-authenticates |
| `paused:reconciliation` | Host auto-reconciles, or user confirms outcome |
| `failed:logic` | Host triggers auto-fix, then retries |
| `failed:internal` | User contacts support; no automatic recovery |

Normal scheduling resumes once the issue is resolved.

**Single point of failure:** If any handler fails, the entire workflow pauses. The failed handler must be resolved (retry succeeds, user action, or auto-fix) before any other handler runs. This ensures:

* Linear progression — no "jumping ahead" while something is stuck
* No state divergence — producer doesn't keep ingesting while consumer is broken
* Simple reasoning — one thing is wrong, fix it, then proceed

---

## Run Lifecycle Integration

The scheduler responds to run status changes:

| Run Status | Scheduler Action |
|------------|------------------|
| `committed` | Record `wakeAt`; clear dirty/queued flags; check for next triggers |
| `paused:transient` | Schedule retry after backoff; triggers accumulate |
| `paused:approval` | Pause workflow; await user action |
| `paused:reconciliation` | Pause workflow; await resolution |
| `failed:logic` | Trigger auto-fix; schedule retry after fix |
| `failed:internal` | Pause workflow permanently; alert user |

**During backoff or auto-fix:** Triggers still accumulate (producer schedules queue, new events mark consumers dirty). When the new run starts, it will process accumulated work.

**Scripts cannot catch tool errors.** All failure classification and retry logic is host-managed (see Chapter 09 for classification, Chapter 15 for retry policies).

For v1, backoff is per-workflow: if any handler is backing off, the entire workflow waits. This is conservative but simple.

---

## Observable State

Users see workflow-level status, not internal handler details:

| What users see | Description |
|----------------|-------------|
| **Status** | Running / Idle / Needs attention / Stopped |
| **Issue description** | Human-readable: "Waiting for you to reconnect Gmail" |
| **Schedule** | "Checks every 5 minutes" / "Next check in 3 min" / "Runs daily at 9am" |
| **Recent activity** | "Processed 3 emails → added to spreadsheet" |
| **Pending work** | See Chapter 17 (Inputs & Outputs) |

Internal details (phases, handlers, topics, retry chains) are not exposed to users — they are implementation concerns managed by the host.

---

## Summary

**Producers**: Run on configured schedule (interval or cron).

**Consumers**: Run when new events arrive or scheduled wake time (`wakeAt`) is reached. Return `wakeAt` from prepare for time-based patterns — honored regardless of whether reservations are empty.

**Run management**: Each attempt is a separate record linked by `retry_of`. Phase and status are orthogonal — failures pause execution but don't change phase. Phase reset is aggressive before mutation, forbidden after.

This design:

* **Minimizes latency** — event-driven consumers wake immediately on new events
* **Enables precise timing** — time-based consumers specify exact wake times, no polling
* **No missed runs** — both producers and consumers queue instead of skip during active runs
* **Preserves correctness** — phase reset only before mutation; after mutation, must proceed forward
* **Full observability** — every attempt recorded, failure history preserved
* **Handles restart gracefully** — crashed runs detected, recovery applies phase reset rules
