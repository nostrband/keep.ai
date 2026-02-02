# Keep.AI Workflow Execution Model (v1)

This document defines the **v1 execution model** for Keep.AI automations.
The goal is **correctness, observability, and safety under suspension**, even at the cost of throughput or flexibility. Performance and concurrency optimizations are explicitly out of scope for v1.

---

## Rationale

Keep.AI executes automation code that is **generated, repaired, and evolved by LLMs**, against **external systems that are unreliable, stateful, and outside our control**. Unlike interactive agents, workflows are expected to run **autonomously**, over long periods of time, while remaining **safe, explainable, and correct**.

Several constraints make a naïve “run the free-form code top-to-bottom” execution model insufficient:

* **Execution may be suspended at arbitrary points** due to permission requests, user approvals, retries, rate limits, or reconciliation of uncertain external side-effects.
* **Code is untrusted by default** (authored by LLMs, possibly influenced by external data) and must be sandboxed and constrained without eliminating its ability to solve real problems using general-purpose programming.
* **External environments are mutable and non-deterministic**: data may change between retries, network calls may return uncertain results with unpredictable latency.
* **Workflows must continue autonomously under transient failures**, while still giving users clear visibility and control when human intervention is required.
* **LLMs must retain expressive freedom** to implement non-trivial logic (parsing, transformation, correlation), but without being able to violate safety, idempotency, or delegation guarantees.

These constraints rule out several common approaches:

* long-lived VM execution (cannot suspend safely),
* implicit retries (cause duplicate side-effects),
* fully dynamic replanning (breaks approvals, observability and security),
* or rigid no-code DAGs (too restrictive for LLM-authored logic).

The execution model defined in this chapter addresses these constraints by **explicitly structuring automation into durable, inspectable units of work**, separating *selection* from *mutation*, and making all side-effects and blocking points first-class runtime concerns. It enforces just enough structure to guarantee correctness and explainability under suspension and failure, while still allowing LLMs to use general-purpose code to solve problems.

This model is intentionally conservative for v1: it prioritizes **correctness, debuggability, and user trust** over throughput or parallelism. It provides a stable foundation on which more advanced execution patterns can be introduced later without weakening the delegation contract.

---

## Core Principles

1. **Single-threaded correctness**

   * At most **one workflow run is active at any time**
   * At most **one consumer run per workflow** is active
   * If a run blocks (approval, reconciliation, failure), the entire workflow pauses

2. **Durable delegation**

   * Automations are treated as **delegated jobs**
   * Any best-effort behavior is made **fully observable**
   * The system must be able to explain:

     * what inputs were selected
     * what mutation was attempted
     * why it is blocked or failed

3. **Explicit effects**

   * External side-effects are **never implicit**
   * All mutations go through host-enforced permissions, idempotency, and reconciliation
   * Scripts never directly manage retries or uncertain commits

---

## High-Level Architecture

A workflow consists of:

* **Topics**: durable event streams (inputs and intermediate work)
* **Producers**: read-only ingress logic that enqueues events
* **Consumers**: deterministic processors that:

  * select inputs
  * perform exactly one mutation
  * optionally emit downstream events

All execution happens in a **JS sandbox** with all external access capabilities controlled by host.

---

## Topics

### Definition

A **topic** is a durable, append-only event stream.

Each event has:

* `topic`
* `messageId` (stable, caller-provided or host-generated)
* `payload`
* host-managed metadata:

  * `status` — `pending`, `consumed`, `skipped`
  * `reserved_by` — (optional) reference to the consumer run that has reserved this event as an input; indicates the event is currently in-flight and cannot be selected by another run until the claiming run resolves (commit or skip).
  * `created_by` — reference to producer run that has created the event

### Properties

* Topics are **fully observable** in the UI
* Events are **not deleted by default**

  * They are marked as consumed/handled
* Topics have **exactly one consumer** in v1
* Topics may be used as:

  * ingress (emails, Slack messages, timers)
  * internal workflow edges

---

## Producers

### Purpose

Producers convert unstructured external inputs into **formal system events**.

### Rules

* Producers:

  * may perform **read-only** operations
  * may enqueue events into topics; publishing is idempotent and deduplicated by event identifier, allowing producers to retry safely under transient failures
* Producers:

  * **may not perform external mutations**
  * **may not consume events**
* Producers have a checkpoint store (KV) for ingress bookkeeping (cursors/checkpoints), not workflow logic. This store is not accessible to consumers, any data needed for consumers must be carried by events.
* Users have UI controls to reset KV store and/or topic queues to allow re-processing.
* Users do not have visibility into KV store, and have only limited topic queue management capabilities to avoid breaking the delegation contract.

### Example

```js
producers: {
  async pollEmail(ctx) {
    const emails = await ctx.gmail.search({ query: "newer_than:24h" });
    for (const e of emails) {
      await ctx.publish("email.received", {
        messageId: e.id,
        subject: e.subject,
        from: e.from,
      });
    }
  }
}
```

---

## Consumers

A **consumer** processes events from one or more subscribed topics and performs **at most one external mutation per run**.

### Subscriptions

* A consumer may subscribe to **multiple topics**
* Each run has exactly **one trigger event** chosen by consumer code

  * This event determines:

    * why the run started
    * UX attribution
    * ordering

---

## Consumer Execution Model

Consumers are structured as **three explicit phases**:

```
prepare → mutate → next
```

This structure is enforced by the host.

---

## Phase 1: `prepare`

### Purpose

* Select and pin **exact inputs**
* Compute all data needed for mutation
* Declare what events will be consumed if the consumer run succeeds

### Allowed Operations

* Read-only connector calls
* Queue reads:

  * `peek`
  * `getByIds`
* Local computation
* Building payloads and previews

### Forbidden Operations

* External mutations
* Publishing events
* Consuming events

### Indeterminism Handling

`prepare` may use time and randomness. Keep.AI does not aim to allow deterministic replay of `prepare` in v1 because prepare has no external side-effects and its output is persisted atomically only on success. For Maintainer, the runtime provides all tool call traces and logs. Future versions may add capture/replay of nondeterministic sources for improved reproducibility.

### Output

`prepare` must return a **PrepareResult**:

```ts
{
  selectionId?: string,        // stable identifier (host may generate)
  reservations: Array<{
    topic: string,
    ids: string[]
  }>,
  data: { ... },               // payload needed for mutate
  ui?: { ... }                 // optional UX metadata (previews, trees)
}
```

### Semantics

* The host **persists the PrepareResult atomically**
* The data and reservation are considered **pinned**
* No other consumer run may start until this run resolves

### Reservations and Commit Semantics

The `reservations` field declares **exactly which existing events this run intends to consume if it commits successfully**. Reservations are the cornerstone of Keep.AI’s commit semantics: they bind a planned mutation to a specific, finite set of inputs before any side-effects occur. The runtime uses reservations to pin inputs during suspension (approvals, retries, reconciliation), to ensure that the mutation is applied **at most once** and **only in response to those inputs**, and to make partial progress fully observable. Reserved events are not consumed immediately; they are atomically marked as reserved on `prepare` success, and later as consumed only after `mutate` and `next` complete successfully. If a run fails or the mutation becomes indeterminate, reservations remain unconsumed and linked to the run, allowing the user to inspect exactly which inputs were involved and to resolve or retry safely without hidden reprocessing or drift.

---

## Phase 2: `mutate`

### Purpose

Perform **exactly one external mutation**.

### Allowed Operations

* **At most one mutator call**
* Read-by-ID operations only, i.e.:

  * `getById`
  * `getByUniqueKey`

### Forbidden Operations

* List/search/scan reads
* Queue peeks
* Publishing events
* Multiple mutations

### Allowed Read Operations in `mutate`

During `mutate`, consumers are permitted to perform **read-by-identifier** operations (such as `getById` or `getByUniqueKey`). These reads are necessary to support common integration patterns where external systems do not provide atomic *upsert* or conditional mutation APIs. In such cases, the script must determine whether a target object already exists (e.g., “insert vs update”) immediately before performing the mutation. Disallowing all reads in `mutate` would make the use of these integrations impractical or force runtime into emulating these complex transactions. Allowing narrowly scoped, identifier-based reads preserves the ability to express real-world connector logic in code while keeping mutation semantics bounded and auditable.

### Suspension & Retry

* If mutation:

  * fails transiently
  * requires approval
  * enters reconciliation
    then the run is suspended and `mutate` is retried later with the **same PrepareResult**

### Idempotency

* Mutations are bound to a **payload hash**
* Approvals are tied to this hash
* Re-running `mutate` with the same payload is safe
* Per-tool reconciliation logic handles mutation specific details at runtime level

---

## Phase 3: `next`

### Purpose

Optionally produce downstream workflow events derived from the mutation result.

### Allowed Operations

* Publishing events to topics
* Local computation

### Forbidden Operations

* External mutations
* Queue reads or consumption

### Semantics

* Publishing is host-durable and idempotent
* Failures here block the workflow (no silent drops)

---

## Commit Semantics

If and only if:

* `mutate` completes successfully
* `next` completes successfully

Then the host atomically:

1. Marks all events from `reservations` as **consumed**
2. Records the mutation outcome

If the mutation enters an **indeterminate** state:

* No reservations are consumed
* User action is required (skip / retry)

---

## Event Consumption Model

* Events are **not removed**
* They transition through states:

  * `pending`
  * `consumed`
  * `skipped`
* Consumption is **host-managed**
* Scripts never manually dequeue events

---

## Safety of Reads in `mutate`

To prevent selection drift and livelock:

* **List/search reads are disallowed in `mutate`**
* Only read-by-id or key-based lookups are allowed
* Any selection logic must occur in `prepare`, LLMs are heavily prompted to ensure that

This guarantees:

* Stable approvals
* No payload churn after suspension
* No hidden replay semantics

Future versions may introduce guarded reads or other guardrails.

---

## Workflow Declaration Shape

```js
export default Keep.workflow({
  name: "example",

  topics: {
    "email.received": {},
    "row.created": {},
  },

  producers: { ... },

  consumers: {
    myConsumer: Keep.consumer({
      subscribe: ["email.received"],

      async prepare(ctx, trigger) { ... },

      async mutate(ctx, prepared) { ... },

      async next(ctx, prepared, mutationResult) { ... },
    })
  }
});
```

---

## Guarantees (v1)

* **Security**: all mutations are permission-checked and allow explicit approval
* **Determinism**: selected inputs do not change after prepare
* **Observability**: every blocked or failed run is explainable
* **Correctness-first**: no partial commits, no silent inconsistent retries

---

## Non-Goals (v1)

* Parallel consumer execution
* Multi-consumer topics
* Dynamic replanning after approval
* High-throughput streaming

These may be introduced later as explicit extensions.
