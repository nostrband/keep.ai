# 13. Mutation Reconciliation

This chapter defines how Keep.AI handles **indeterminate mutation outcomes** when interacting with external systems.

It specifies:

* how mutation attempts are tracked
* how uncertainty is detected
* how reconciliation is performed
* when the system must fail closed and escalate

This mechanism is the **foundation** for higher-level idempotency and replay guarantees (Chapter 14).

---

## 13.1 Problem statement

External systems are not transactional.

When the host performs a side-effecting API call, it may encounter outcomes where it is **impossible to know** whether the mutation was applied:

Examples:

* request timed out after being sent
* process crashed mid-call
* network failure after write
* API returned an error indicating uncertain commit (e.g., ambiguous 5xx)
* external service provides no reliable reconciliation mechanism

In these cases:

* retrying may duplicate or corrupt state
* skipping may lose the mutation
* correctness cannot be established deterministically

Keep.AI must explicitly model **unknown outcomes**, reconcile them conservatively, and escalate when correctness cannot be established.

---

## 13.2 Scope and non-goals

### In scope

* per-mutation tracking
* per-tool reconciliation logic
* conservative handling of uncertainty
* escalation when correctness cannot be determined

### Out of scope

* grouping multiple mutations into a higher-level unit of work (see Chapter 12)
* workflow-level retries and scheduling
* script-level control flow
* distributed transactions
* rollback of irreversible external effects

This chapter concerns **one mutation attempt at a time**.

---

## 13.3 Definitions

### Sequential execution invariant

Mutations within a script are **strictly sequential**, enforced by the tool wrapper layer (see Chapter 04, "Sandbox and tool wrappers").

Even if a script attempts concurrent mutations (e.g., `Promise.all([mutationA(), mutationB()])`), the tool wrapper serializes them — only one mutation may be `in_flight` at a time.

This means:

* a script cannot have multiple mutations `in_flight` simultaneously
* if a mutation transitions to `needs_reconcile`, the script is aborted before the next mutation can start
* there is no concurrency between mutations within a single script execution

This invariant simplifies reconciliation: at most one mutation per script execution can be in an uncertain state at the point of abort.

### Mutation

A **mutation** is a single side-effecting operation against an external system.

Examples:

* send an email
* create or update a record
* post a message
* trigger a webhook

Each mutation is executed through a host-controlled tool wrapper and tracked independently.

### Indeterminate outcome

An outcome is **indeterminate** when the host cannot reliably determine whether a mutation committed.

Indeterminate outcomes are not safely recoverable by "retrying" unless reconciliation can prove commit or non-commit.

---

## 13.4 Mutation ledger

The host runtime maintains a durable **mutation ledger**.

Each ledger record is keyed by **mutation identity** (see Chapter 14, §14.3 for how identity is computed).

Each record contains:

* mutation identity (primary key)
* mutation parameters (or a stable hash, plus enough metadata to perform reconciliation)
* status
* timestamps + attempt counters
* mutation result (when known)

The ledger is written such that a crash/restart never loses track of mutations that **may have committed**. This relies on storage layer durability guarantees (e.g., transactional writes, WAL).

---

## 13.5 Mutation states

Mutations progress through the following states:

* `in_flight`
  The host is attempting the mutation. The request may have been sent; the mutation may or may not have committed. This state is written durably before (or at the latest, as) the external request is initiated.

* `applied`
  The host has high confidence the mutation committed, and has a stable result (if any).

* `failed`
  The host has high confidence the mutation did not commit (safe to attempt again).

* `needs_reconcile`
  The mutation outcome is unknown, and the host intends to resolve it using reconciliation.

* `indeterminate`
  Terminal state. The host cannot determine whether the mutation committed (reconciliation unavailable or exhausted). The system must fail closed and escalate.

> **Rule:** Timeouts and ambiguous failures must transition to `needs_reconcile`, not `failed`.

---

## 13.6 Tool contract: `mutate` + `reconcile`

### 13.6.1 Mutator tools

Every side-effecting tool method is treated as a **mutator**.

Tools must not expose transport-level idempotency/reconciliation details to scripts (headers, request IDs, etc.). Those details are connector-internal.

### 13.6.2 Reconcile method

For each mutator operation that can be reconciled, the connector provides (pseudocode):

```
reconcile(mutation_params) -> { result?, status }
```

Semantics:

* returns `status=applied` along with `result` if the mutation already happened (the result should match what `mutate` would return, as closely as the external system allows)
* returns `status=failed` if the mutation definitely did not happen
* returns `status=retry` if reconciliation should be retried (including on timeout or transient errors)

If a `reconcile` method is provided, it must eventually return `applied` or `failed` — it cannot declare permanent indeterminacy. If the connector cannot check (e.g., timeout, transient error), it returns `retry`.

Absence of `reconcile` method for a mutation means reconciliation is not supported and `needs_reconcile` is immediately transitioned to `indeterminate`.

### 13.6.3 Reconciliation examples

**Gmail: send email**

* mutation params: `{ to, subject, body, idempotency_key }` (connector generates idempotency key)
* reconcile: search sent folder for message matching idempotency key (e.g., in headers or body)
* if found → `applied` with message ID
* if not found → `failed`
* if search fails → `retry`

**Database: insert row**

* mutation params: `{ table, data, unique_constraint_values }`
* reconcile: query by unique constraint
* if row exists with matching data → `applied` with row ID
* if row does not exist → `failed`
* if query fails → `retry`

**Webhook: fire-and-forget**

* no `reconcile` method — external system provides no way to verify delivery
* uncertain outcome → immediate `indeterminate`

---

## 13.7 Host runtime semantics

### 13.7.1 Immediate reconciliation

When a mutation result is indeterminate (timeout, ambiguous errors), the tool wrapper must attempt reconciliation immediately, rather than immediately aborting the script:

* if `reconcile` is absent → update ledger to `indeterminate`, escalate
* if `reconcile` returns `applied` → update ledger to `applied` with `result`, return result from tool call
* if `reconcile` returns `failed` → update ledger to `failed`, tool call throws exception, script may handle it
* if `reconcile` returns `retry` → update ledger to `needs_reconcile`, abort script, hand off to background reconciliation

This optimization saves background reconciliation job overhead.

### 13.7.2 Indeterminate outcomes are not catchable

If a mutation transitions into `needs_reconcile`, the host runtime must:

* abort script execution immediately (fail closed)
* prevent the script from catching/handling that condition
* take over reconciliation as a host responsibility

Rationale:

* continuing execution after an unknown mutation outcome risks cascading corruption and compound uncertainty.

### 13.7.3 Reconciliation loop

While in `needs_reconcile`, the host performs reconciliation attempts with backoff (see Chapter 15 for backoff and policy configuration):

* If `reconcile(params)` returns `applied`:

  * set state to `applied`
  * store the `result`
* If `reconcile(params)` returns `failed`:

  * set state to `failed`
* If `reconcile(params)` returns `retry`:

  * remain in `needs_reconcile`
  * retry until policy limits are reached (Chapter 15)

If reconciliation is unavailable (no reconcile method) or policy limits are exhausted:

* set state to `indeterminate`
* escalate (see §13.9)

---

## 13.8 State machine diagram

```mermaid
stateDiagram-v2
  [*] --> in_flight: start mutation (durably record)

  in_flight --> applied: success response
  in_flight --> failed: failed response
  in_flight --> needs_reconcile: timeout/crash/ambiguous error
  in_flight --> indeterminate: no reconcile method

  needs_reconcile --> applied: reconcile() => applied
  needs_reconcile --> failed: reconcile() => failed
  needs_reconcile --> needs_reconcile: reconcile() => retry
  needs_reconcile --> indeterminate: attempts exhausted

  indeterminate --> [*]: fail closed + escalate
```

Notes:

* `needs_reconcile` may persist across restarts/offline periods. It is not terminal.
* `indeterminate` is terminal and always escalates to the user.
* If a `reconcile` method exists, "Try again" action is available during escalation (resets attempt counter, returns to `needs_reconcile`).

---

## 13.9 Escalation

If a mutation reaches `indeterminate`:

* script execution must fail closed
* the run must be escalated to the user
* workflow is paused, no more runs are scheduled
* the system must not route this to automated repair / Maintainer logic

Escalation must clearly communicate:

* which mutation is affected (tool + target)
* what was attempted (high-level description)
* why the outcome is unknown
* whether the connector can or cannot verify
* what manual verification is required

This matches the system policy described in `09-failure-repair.md` ("Indeterminate side-effect outcomes").

Escalation actions (see also Chapter 12, §12.7):

* **"Try again"** — reset attempt counter, return to `needs_reconcile` (only available if mutation has a `reconcile` method)
* **"It didn't happen"** — manually sets `failed` state; safe to retry
* **"Skip this item"** — mark the logical item `skipped` (see Chapter 12)

Note: "It happened, here is the result ID" is intentionally out of scope for v1.

---

## 13.10 Relationship to idempotency

Reconciliation answers the question:

> Did this mutation happen or not?

Only after the system can establish commit or non-commit can it safely:

* cache results
* replay mutations
* provide higher-level idempotency guarantees

These higher-level semantics are specified in **Chapter 14 (Idempotency)**.

---

## 13.11 Summary

Mutation reconciliation in Keep.AI:

* models uncertain outcomes explicitly (`needs_reconcile`, `indeterminate`)
* records and persists in-flight mutations
* attempts connector-defined reconciliation immediately with backoff
* blocks execution on unknown outcomes
* fails closed and escalates when correctness cannot be established

This provides the reliability foundation required for delegated automations.
