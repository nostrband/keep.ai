# 06. Execution Model (v1)

This chapter defines the **v1 execution model** for Keep.AI automations.

The goal is **correctness, observability, and safety under suspension**, even at the cost of throughput or flexibility. Performance and concurrency optimizations are explicitly out of scope for v1.

---

## Rationale

Keep.AI executes automation code that is **generated, repaired, and evolved by LLMs**, against **external systems that are unreliable, stateful, and outside our control**. Unlike interactive agents, workflows are expected to run **autonomously**, over long periods of time, while remaining **safe, explainable, and correct**.

Several constraints make a naïve "run the free-form code top-to-bottom" execution model insufficient:

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

The execution model addresses these constraints by **explicitly structuring automation into durable, inspectable units of work**, separating *selection* from *mutation*, and making all side-effects and blocking points first-class runtime concerns. It enforces just enough structure to guarantee correctness and explainability under suspension and failure, while still allowing LLMs to use general-purpose code to solve problems.

This model is intentionally conservative for v1: it prioritizes **correctness, debuggability, and user trust** over throughput or parallelism. It provides a stable foundation on which more advanced execution patterns can be introduced later without weakening the delegation contract.

---

## High-Level Architecture

A workflow consists of **events** and **handlers**.

**Events** are the units of work — durable records stored in topic-based streams. Each event represents something that happened (an email arrived, a row was created) and flows through the workflow until processed.

**Handlers** are the code that processes events. There are two types:

* **Producers** — read-only ingress handlers that poll external systems and enqueue events into topics
* **Consumers** — processing handlers that select input events, perform **exactly one** external mutation, and optionally emit downstream events

All handler execution happens in a **JS sandbox** with all external access capabilities controlled by the host.

### Handler Isolation

Although a workflow is defined as a single script file, **each producer and consumer runs in its own isolated execution context**. There is no shared in-memory state between handlers — they communicate through Topics, and each handler has its own persistent state (received as input, returned as output). Use of shared global variables across handlers is a **logic error**: LLMs are prompted to avoid this pattern, and script validation may reject it via static analysis.

This isolation:

* Prevents implicit coupling between components
* Ensures each handler can be suspended, restarted, or retried independently
* Enables future parallel execution of independent handlers
* Makes the data flow between components explicit and observable

When reasoning about workflow execution, treat each producer and consumer as a separate program that reads from and writes to durable storage, not as functions sharing a runtime.

---

## Core Principles

1. **Single-threaded correctness**

   * At most **one workflow run is active at any time**
   * At most **one mutation operation per workflow** is active
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

## Consumer Three-Phase Model

Consumers — the handlers that process events and perform mutations — execute in **three explicit phases**:

```
prepare → mutate → next
```

Each phase has a **durable checkpoint**: the host persists results atomically before proceeding to the next phase. This enables safe suspension, retry, and observability at each boundary.

| Phase | Purpose | Checkpoint |
|-------|---------|------------|
| **prepare** | Select inputs, compute mutation parameters (read-only) | PrepareResult: pinned inputs + computed data |
| **mutate** | Perform exactly one external mutation | Mutation ledger: outcome tracked by host |
| **next** | Emit downstream events, update state | Run completion: state + event consumption |

This separation ensures:

* **Inputs are pinned before side-effects** — what you approved is what executes
* **Mutations are isolated** — one mutation per run, tracked in a ledger, reconcilable
* **Downstream effects are decoupled** — `next` always runs, even if mutation was skipped

The host enforces phase boundaries: attempting a mutation in `prepare` or a read in `mutate` is an immediate abort. See Chapter 06b for detailed phase semantics.

---

## Internal Infrastructure vs External Tools

Keep.AI distinguishes between **internal infrastructure** (managed by the host with atomic transactions) and **external tools** (accessing remote systems with network uncertainty).

### Internal Infrastructure

**Topics** are internal to Keep.AI:

* No network latency or uncertainty
* Atomic transactions with handler state and run completion
* No reconciliation concept — operations either succeed or fail deterministically
* Host-managed, not connector-based

### External Tools

Scripts access external systems (APIs, databases, services) through **host-managed tool wrappers**. Tool wrappers enforce:

* **Phase restrictions**: Operations restricted by execution phase
* **Mutation tracking**: Before executing a mutation, the wrapper records state in the ledger (see Chapter 13)
* **Reconciliation**: Uncertain outcomes are resolved via tool-specific reconciliation methods (see Chapter 13)
* **Permission checks**: Every operation is validated against granted permissions (see Chapter 11)

Violations (e.g., attempting mutation in `prepare`) result in immediate abort and are classified as logic errors for repair.

### Phase Restrictions Summary

| Operation | Producer | prepare | mutate | next |
|-----------|----------|---------|--------|------|
| Topic peek | ✗ | ✓ | ✗ | ✗ |
| Topic publish | ✓ | ✗ | ✗ | ✓ |
| External read | ✓ | ✓ | ✗ | ✗ |
| External mutation | ✗ | ✗ | ✓ (one, terminal) | ✗ |

---

## Guarantees (v1)

* **Security**: all mutations are permission-checked and allow explicit approval
* **Determinism**: selected inputs do not change after prepare
* **Observability**: every blocked or failed run is explainable
* **Correctness-first**: no partial commits, no silent inconsistent retries
* **Idempotency**: replay returns cached results, no duplicate mutations

---

## Limitations (v1)

### Staleness Between Prepare and Execute

External state may change between `prepare` (when reads happen) and mutation execution. This is a fundamental limitation of client-side orchestration against external systems we don't control.

**Scenario**: `prepare` reads "row does not exist", decides to insert. User approves. One hour later, mutation executes — but another process created the row. Insert fails or creates duplicate.

**Why this is unsolvable at our layer:**

Without service-side support for conditional writes ("insert if not exists") or transactions, we cannot guarantee consistency. Even re-reading immediately before writing is racy — another process can write between our read and write.

This is why `mutate` forbids all reads: rather than pretend to solve an unsolvable problem, v1 makes `mutate` a pure function of `prepare` output. The staleness window is `prepare` → `execute`, and we don't hide it.

**Mitigation strategies:**

| Strategy | Description |
|----------|-------------|
| **Single-writer** | Design one workflow to own each destination. No other workflows or processes write there. |
| **Append-only** | Insert new records rather than updating. No "insert vs update" decision needed. |
| **External constraints** | Use unique keys in the external system. Conflicts fail loudly rather than creating duplicates. |
| **Idempotent services** | Target services where repeated writes are safe (e.g., "set value" rather than "increment"). |
| **Accept conflicts** | For multi-writer scenarios, accept that conflicts happen. Failed mutations surface to users for resolution. |

**Best practice**: Treat each workflow's output destination as owned by that workflow.

### No Cross-Workflow Coordination

v1 workflows are independent. There is no mechanism for:

* Locking shared resources across workflows
* Distributed transactions spanning multiple workflows
* Ordering guarantees between workflows

Design workflows to be self-contained with dedicated outputs.

---

## Non-Goals (v1)

* Parallel consumer execution
* Multi-consumer topics
* Dynamic replanning after approval
* High-throughput streaming
* Event reprocessing (see Chapter 20)
* Workflow-scoped shared state (see Chapter 20)

These may be introduced later as explicit extensions.

---

## Related Chapters

* Chapter 06a — Topics and Handlers
* Chapter 06b — Consumer Lifecycle
* Chapter 13 — Mutation Reconciliation
* Chapter 16 — Scheduling
