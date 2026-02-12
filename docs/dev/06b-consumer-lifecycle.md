# 06b. Consumer Lifecycle

This chapter defines the detailed execution semantics for consumers.

For the conceptual model, see Chapter 06. For topic and handler definitions, see Chapter 06a.

---

## Three-Phase Model

Consumers execute in **three explicit phases**, enforced by the host:

```
prepare → mutate → next
```

Each phase has strict rules about what operations are allowed. This separation ensures:

* Inputs are pinned before any side-effects
* Mutations are isolated and trackable
* Downstream effects are decoupled from mutation success

---

## Phase 1: prepare

### Purpose

* Select and pin **exact inputs**
* Compute all data needed for mutation
* Declare what events will be consumed if the run succeeds

### Signature

```ts
async prepare(ctx, state) → PrepareResult
```

Where `state` is the consumer's previous state from the last successful run (undefined on first run).

### Allowed Operations

* Read-only external calls
* Topic reads (i.e. `peek`, `getByIds`) for subscribed topics
* Local computation
* Building payloads and previews

### Forbidden Operations

* External mutations
* Publishing events
* Consuming events
* Accessing non-subscribed topics

### Output: PrepareResult

```ts
{
  reservations: Array<{
    topic: string,
    ids: string[]
  }>,
  data: { ... },     // payload for mutate and next
  ui?: {
    title: string,      // user-facing description of the mutation
  },
  wakeAt?: string    // optional ISO 8601 datetime for time-based wake (see Chapter 16)
}
```

### The `ui` Field

The `ui` field provides **user-facing metadata for the pending mutation**. This is how the UX learns what this consumer run means to the user, without exposing internal workflow structure.

* `title` — describes what the mutation will do in user terms (semantic description)

**Examples:**

```ts
// Adding a spreadsheet row
ui: { title: "Add to Reports sheet" }

// Sending an email
ui: { title: "Send reply to alice@example.com" }

// Posting to Slack
ui: { title: "Post summary to #finance" }
```

**Why this matters:**

The UX shows users an Inputs→Outputs view (see Chapter 17). The input description comes from the producer event's `title`. The output description comes from `prepareResult.ui.title`. This allows users to see "Email from alice → Row added to Reports sheet" without knowing about internal topics, consumers, or phases.

The `ui.title` is attached to the mutation record and displayed in:
* Pending mutation indicators
* Completed mutation history
* Blocked run indicators

### Title vs Preview (Trust Boundary)

The `ui.title` is a **semantic description** — what the mutation means to the user. Scripts are untrusted code, so `ui.title` cannot be fully trusted to match actual behavior.

**What the host provides separately:**

If users need to see the actual mutation payload (for approval prompts or to verify what was attempted), the host formats this from the **actual mutation call parameters**, not from script-declared metadata. This ensures users see what was actually attempted, not what the script claimed it would do.

| Source | Content | Trust Level |
|--------|---------|-------------|
| `ui.title` | Semantic description ("Add row for alice") | Script-declared, best-effort |
| Mutation preview | Actual call parameters | Host-observed, trustworthy |

For approval flows and blocked mutation displays, the host may show both: the semantic title for context, and the actual parameters for verification.

**Prompting guidance for LLMs:**

* Always provide `ui.title` when a mutation will occur
* Describe what the mutation *means to the user*, not internal details
* Include key identifiers (email address, row name) for recognition
* Do not attempt to preview actual data — the host handles that

Good: `Add row for alice@example.com`
Bad: `Execute sheets.appendRow mutation`

### Reservations

The `reservations` field declares **exactly which events this run intends to consume if it commits successfully**.

Reservations are the cornerstone of Keep.AI's commit semantics: they bind a planned mutation to a specific set of inputs before any side-effects occur. The runtime uses reservations to:

* Pin inputs during suspension (approvals, retries, reconciliation)
* Ensure the mutation is applied **at most once** for those inputs
* Make partial progress fully observable

Reserved events are marked `reserved` on `prepare` success, then `consumed` only after the full run commits. If a run pauses or is retried, reservations remain in `reserved` state, allowing inspection and safe continuation.

### Empty Reservations

`prepare` may return **empty reservations** to indicate "nothing to do right now":

* Waiting for a time window
* Batching threshold not met
* Required correlation event not yet available

When reservations are empty, the run skips `mutate` and proceeds directly to `next`.

For time-based patterns, `prepare` can include `wakeAt` to request a specific wake time. See Chapter 16 for scheduler handling of empty reservations and the `wakeAt` hint.

### Replay Semantics

`prepare` can be relaunched freely because it has no external side effects. On relaunch:

* External reads may return different data (acceptable — no side effects yet)
* PrepareResult is computed fresh and persisted atomically on success

---

## Phase 2: mutate

### Purpose

Perform **at most one external mutation**.

### Signature

```ts
async mutate(ctx, prepared) → void
```

The `mutate` handler is a **deterministic function** of `prepared.data` — it may branch on `prepared.data` to decide which mutation to call (or none), but all data needed for those decisions must be computed in `prepare` and passed via `data`.

### Allowed Operations

* **Zero or one mutator calls** — `mutate` may branch on `prepared.data` and choose not to call any mutation

### Forbidden Operations

* All external reads
* Topic operations (peek, publish)
* Multiple mutations
* Returning data — `mutate`'s return value is discarded by the host

### Mutation is Terminal

The mutation call is the **last operation** in `mutate`. Once a mutation call starts:

* The script is effectively done — host takes over
* Any code after the mutation call is a **logic error**
* The host may enforce this statically or abort if violated

```ts
async mutate(ctx, prepared) {
  await ctx.gmail.send({
    to: prepared.data.recipient,
    subject: prepared.data.subject,
    body: prepared.data.body
  }); // TERMINAL — no code after this
}
```

The mutation result is captured by the host and passed to `next`.

### No Mutation Called

If `mutate` completes without calling any mutation tool, no mutation record is created. The host transitions directly to `next` with `mutationResult = { status: 'none' }`. This is the expected path when `mutate` branches on `prepared.data` and determines no external mutation is needed.

All data that `next` needs in this case must already be in `prepared.data`.

Reserved events are still consumed on commit — the consumer claimed these events and completed its run, so they are done regardless of whether a mutation was called.

### Host-Owned Execution

Once mutation enters `in_flight` state:

1. Host records the attempt in the mutation ledger
2. Host executes the external call
3. Host handles the outcome:
   * Success → record `applied`, proceed to `next`
   * Definite failure → record `failed`; run failure handling proceeds (see Chapter 16)
   * Uncertain → reconciliation (see Chapter 13)

**The `mutate` handler is NOT re-executed during this process.** The host takes over the mutation call directly and handles retries/reconciliation itself. Reconciliation is entirely host-owned.

---

## Phase 3: next

### Purpose

* Produce downstream workflow events derived from the mutation result
* Return updated consumer state

### Signature

```ts
async next(ctx, prepared, mutationResult) → state?
```

Where `mutationResult` is a discriminated union:

```ts
| { status: 'applied', result: T }   // mutation succeeded
| { status: 'none' }                  // no mutation (empty reservations or no mutation call)
| { status: 'skipped' }               // user skipped an indeterminate mutation
```

### Allowed Operations

* Publishing events to topics
* Local computation

### Forbidden Operations

* External mutations
* External reads
* Topic reads

### State Return

`next` may return a state object that becomes the consumer's persistent state:

* State is the **script's own data** — host does not interpret it
* Should be kept small (implementation-defined size limit)
* Committed atomically with run completion
* Optional — consumers without persistent state simply don't return anything

Common uses: counters, rate-limit tracking, caching hints.

### Always Executes

`next` **always executes**, including when:

* Reservations were empty (no mutation attempted)
* Mutate had no mutation call
* User chose "Skip" on an indeterminate mutation

Scripts must handle all `mutationResult` statuses appropriately.

### Replay Semantics

`next` can be relaunched safely:

* Event publishing is deduplicated by `messageId` (last-write-wins, see Chapter 06a)
* State is re-computed and committed on success

---

## Run Lifecycle

### Execution Phase

Each consumer run progresses through **phases**:

```mermaid
stateDiagram-v2
  [*] --> preparing: run starts

  preparing --> prepared: prepare succeeds
  prepared --> mutating: reservations non-empty
  prepared --> emitting: reservations empty (skip mutate)

  mutating --> mutated: mutation applied
  mutated --> emitting: proceed to next

  emitting --> committed: next succeeds
  committed --> [*]: run complete
```

**Phase only moves forward.** There is no `failed` state in the phase diagram. Failures pause execution but do not change the phase.

### Run Status (Orthogonal)

Run status tracks *why* a run is paused or stopped. Status is **orthogonal to phase** — a run can be paused at any phase.

| Status | Meaning | Resolution |
|--------|---------|------------|
| `active` | Currently executing | — |
| `paused:transient` | Transient failure, will retry | Backoff then resume |
| `paused:approval` | Waiting for user approval | User approves/rejects |
| `paused:reconciliation` | Uncertain mutation outcome | Reconciliation or user action |
| `failed:logic` | Script error, auto-fix eligible | Auto-fix then retry |
| `failed:internal` | Host/connector bug | Contact support |
| `committed` | Successfully completed | — |

**Critical invariant:** Failures change run status, not phase. When a paused run resumes, it continues from the same phase.

See Chapter 16 for run status management, retry scheduling, and phase reset rules.

---

## Replay Semantics Summary

| Phase | Can Relaunch? | Side Effects | Atomicity |
|-------|---------------|--------------|-----------|
| prepare | Yes | None | PrepareResult saved on success |
| mutate | Only if mutation not applied | External mutation | Host-owned, ledger-tracked |
| next | Yes | Event publishing (idempotent) | State + event consumption atomic |

**Key invariants:**

* Prepare can always retry — no side effects
* Mutate handler is never re-executed — host takes over the call; on failure the scheduler creates a new run (see Chapter 16)
* Reconciliation is host-owned (see Chapter 13)
* Next can always retry — publishing is idempotent, state committed atomically

**Phase reset:** Before mutation is applied, execution can reset to `prepare` (e.g., for auto-fix). After mutation is applied, execution must proceed through `next`. See Chapter 06 for reset rules.

---

## Commit Semantics

A run commits successfully when `next` completes. The host atomically:

1. Marks all events from `reservations` as `consumed` (or `skipped` if user skipped)
2. Commits state from `next`
3. Records the run as `committed`

If execution pauses (transient failure, approval needed, reconciliation):

* Run status changes (see Run Status table above)
* Phase remains unchanged
* Reservations remain reserved (not consumed)
* Mutation state is preserved
* Execution can resume from the same phase when resolved

---

## Related Chapters

* Chapter 06 — Execution Model (concepts, phase reset rules)
* Chapter 06a — Topics and Handlers
* Chapter 07 — Workflow Operations
* Chapter 09 — Failure Handling (failure classification)
* Chapter 13 — Mutation Reconciliation
* Chapter 16 — Scheduling (run status, retry logic, phase reset implementation)
