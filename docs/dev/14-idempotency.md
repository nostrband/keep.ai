# 14. Idempotency

This chapter defines how Keep.AI provides **idempotent execution** across retries, restarts, and automatic code repair.

Idempotency in Keep.AI is built on top of:

* **Logical items** (Chapter 12) — the unit of work
* **Mutation reconciliation** (Chapter 13) — determining whether mutations committed

It assumes that for every mutation, the system eventually reaches one of the following outcomes:

* the mutation did not happen
* the mutation happened and its result is known
* the mutation outcome is indeterminate and requires escalation

Idempotency governs how *known outcomes* are reused safely.

Idempotency in Keep.AI is **best-effort at its boundaries**, and compensates by providing full observability and clear UX for users to manage indeterminism.

---

## 14.1 Problem statement

Automations must be able to:

* retry after transient failures
* survive crashes and restarts
* tolerate regenerated code ("auto-repair")
* avoid duplicating external side effects
* preserve partial progress deterministically

This is not achievable with:

* script-managed "processed lists"
* distributed transactions
* best-effort retries
* manual idempotency keys

Keep.AI instead:

* groups work into **logical items** (Chapter 12)
* replays execution while consulting the **mutation ledger**
* reuses prior mutation outcomes
* blocks execution when outcomes are unknown

---

## 14.2 Handler execution semantics

The **handler** is the callback function passed to `withItem(id, title, handler)` — the code that processes a single logical item (see Chapter 12, §12.2).

### 14.2.1 Handler execution

The handler is **always executed**, regardless of item state. The handler runs to completion, but any mutation calls are intercepted and will abort (and go to auto-fix) if the item is already done (see §14.2.2).

To allow script to properly skip mutations for done items, the runtime provides:

```
ctx.item.isDone : boolean
```

Rationale: if we skipped handlers for done items, scripts with misplaced side effects would silently break (e.g., Planner putting script-wide logic inside a handler with a wrong assumtion that it always runs). By always executing but aborting on mutations, we catch badly-structured scripts explicitly rather than failing silently.

### 14.2.2 Mutation restriction on done items

Scripts **must not** attempt mutations on completed items. This is a logic error.

Planner and Maintainer agents must be prompted to:

* check `ctx.item.isDone` before any mutation
* structure handlers to exit early when the item is already done
* re-think scripts that unconditionally mutate without checking item state

The invariant:

> **Completed items cannot produce new side effects.**

If a mutation is attempted on a done item, the runtime:

1. aborts the current run
2. classifies this as a **logic error** (repair-eligible per Chapter 09)
3. routes to Maintainer for auto-fix

The expected fix is adding the missing `ctx.item.isDone` guard. This should never happen in correctly generated scripts, but the runtime enforces it as a safety net rather than silently skipping.

---

## 14.3 Mutation identity

Each mutation executed inside an item scope is assigned a **mutation identity**.

Conceptually:

```
mutation_key := hash(
  logical_item_id,
  attempt_id,
  tool_name,
  target_resource,
  operation,
  canonicalized_parameters,
  optional_subkey
)
```

The `attempt_id` ensures that mutations from different attempts (see Chapter 12, §12.5) are independent. Replaying attempt 2 does not consult or deduplicate against mutations from attempt 1.

### Identity vs payload

The tool implementation is responsible for separating **identity** from **payload**:

* **Identity** (`canonicalized_parameters`): parameters that identify *what* is being mutated — e.g., which row, which recipient, which resource
* **Payload**: parameters that define *how* — e.g., message body, field values, content

This separation allows:

* distinguishing writes to different targets within one item (without forcing Planner to use subkeys)
* auto-repair to change content without breaking idempotency
* replay to detect when content changed but target is the same (see §14.5)

### Properties

* stable across retries (within the same attempt)
* stable across auto-repair (content changes don't affect identity)
* unique per logical item per attempt
* computed by the tool wrapper, not the script (see Chapter 04, "Sandbox and tool wrappers")

This key serves as the **primary key** in the mutation ledger (Chapter 13) for looking up prior outcomes during replay.

### Subkey usage

The `optional_subkey` is needed only when a script must execute **two mutations with identical identity** within the same item — e.g., sending two emails to the same recipient with different content.

Without a subkey, the second call would match the first's identity and incorrectly return the cached result.

This is an edge case. Planner should prefer:

* combining into one mutation (e.g., one email with all content)
* using different targets when possible

When unavoidable, the script must provide an explicit subkey to disambiguate:

```javascript
await gmail.send({ to: "alice@example.com", body: "First message", subkey: "welcome" });
await gmail.send({ to: "alice@example.com", body: "Second message", subkey: "confirmation" });
```

Subkeys must be stable across retries and auto-repair — they should reflect *what* is being sent, not *when* or *in what order*. Planner must be prompted to ensure that, Maintainer must be prompted to preserve subkeys.

---

## 14.4 Idempotent replay

### 14.4.1 Replay model

When an item is retried (due to failure, restart, or repair):

* the handler is re-executed from the beginning
* mutations are re-issued by the script
* mutation wrappers consult the mutation ledger

For each mutation call:

* if the mutation is `applied` **with a result** → return cached result, continue
* if the mutation is `failed` → mutation is re-attempted (state transitions to `in_flight`)
* if the mutation is `needs_reconcile` or `indeterminate` → replay is blocked; the system must resolve or escalate before the item can be retried (see Chapter 13)

Note: `failed` does not mean "continue without the mutation." All mutation failures abort the script. The `failed` state indicates the mutation is **safe to re-attempt** — the external effect did not occur. When the runtime retries the run (based on error classification per Chapter 09), the handler re-executes, reaches the mutation call, and re-attempts it.

Scripts never observe mutation states directly — they see either a successful result or an exception.

---

### 14.4.2 Cached results

For mutations in `applied` state, the ledger provides:

* proof of commit
* a stable result (e.g. row ID, message ID)

On replay:

* the cached result is returned
* downstream code sees consistent values
* partial progress is preserved

**Limitations:** This is practical, not perfect. Read-after-write inconsistencies can occur — e.g., script reads emails (A, B), sends C, crashes, replays, now reads (A, B, C), and control flow may differ.

These inconsistencies are fundamentally undetectable at runtime. The Maintainer may be able to fix the script logic to avoid the dependency, but cannot undo mutations that already occurred.

When such bugs are fixed, the Maintainer classifies them as `potentially_impactful` (see Chapter 04, "Impact classification"). This triggers:

* blocked auto-fix activation pending user review
* display of items processed while the bug existed ("blast radius")
* user inspection and approval before resuming

This doesn't detect actual damage — it surfaces uncertainty for user judgment, consistent with the delegation contract.

This is still best-effort: spurious auto-fix cycles are acceptable, infinite loops are aborted by host (repair budget limits, see Chapter 15). This harness is assumed practical for most cases, not a replacement for distributed transactions.

---

## 14.5 Payload mismatch

As described in §14.3, mutation identity excludes payload (content). This means on replay, a mutation may have the same identity (same target) but different payload (different content) — i.e. due to timing or auto-repair changing how content is constructed.

If replay attempts a mutation whose identity matches an already-applied mutation but whose payload differs:

### Payload comparison

The tool wrapper determines mismatch significance:

* if the tool provides `comparePayload(oldPayload, newPayload)` → call it
* if not provided → treat any mismatch as `significant`

The `comparePayload` method returns one of:

* `equivalent` — semantically identical (e.g., whitespace differences)
* `minor` — different but acceptable (e.g., timestamp in metadata)
* `significant` — meaningful divergence requiring attention

### Default behavior

* do **not** re-apply the mutation (preserves idempotency)
* based on `comparePayload` result:
  * `equivalent` or `minor` → return cached result, continue execution
  * `significant` → mark item `needs_attention`, abort run

Tools that don't provide `comparePayload` are conservative by default — any payload change triggers escalation.

Rationale:

* preserves determinism
* avoids cascading divergence
* prevents silent data corruption
* allows per-tool risk assessment

### Update-in-place (v2 consideration)

Some tools could theoretically support safe update-in-place semantics (e.g., updating a database row rather than returning stale cached result). However, this significantly complicates the mutation state machine and creates new failure modes mid-replay.

For v1, we keep it simple: `applied` is terminal, payload mismatch returns cached result, significant mismatches escalate. Update-in-place may be revisited for v2 if practical use cases justify the complexity.

---

## 14.6 Failure handling inside items

### Failure sources

A handler may fail due to:

* **mutation failure** — a tool call fails and throws (see Chapter 13)
* **handler exception** — script logic throws outside of a tool call

In both cases, the script aborts immediately. Scripts **cannot** catch these errors and continue — this is host-enforced.

### Item state on failure

When a handler fails:

* the item is marked `failed`
* any mutations that were `applied` before the failure remain applied
* the run aborts

### Error classification

The runtime classifies the abort reason:

* **tool exceptions** carry an error class set by the tool (e.g., transient, permission, precondition)
* **pure handler exceptions** (not from tools) are classified as logic errors

Based on classification, the runtime decides next steps:

* transient → retry with backoff (see Chapter 15)
* logic error → auto-repair (Maintainer)
* permission/precondition/indeterminate → escalate to user

See Chapter 09 for the full failure taxonomy.

### Retry behavior

When the runtime retries (transient or after successful auto-fix):

* the item remains in `failed` state until the handler completes
* the handler re-executes from the beginning
* applied mutations return cached results (see §14.4)
* failed mutations are re-attempted

User can choose to skip an item during escalation.

---

## 14.7 Guarantees

With this model, Keep.AI guarantees:

* no duplicate mutations across retries
* deterministic replay of applied mutations
* preservation of partial progress
* no execution on unknown outcomes
* no silent continuation on degraded state
* clear, bounded user intervention points

---

## 14.8 Non-goals

Idempotency does **not** guarantee:

* rollback of irreversible actions
* correctness when reconciliation is impossible
* automatic resolution of semantic conflicts
* recovery when external systems provide insufficient guarantees

Those cases are escalated by design.

---

## 14.9 Summary

Idempotency in Keep.AI is achieved by:

* grouping work under **logical items** (Chapter 12)
* executing handlers deterministically
* binding mutations to item-scoped identities
* replaying via cached mutation outcomes
* blocking execution on degraded or unknown states (Chapter 13)
* escalating instead of guessing

This makes delegated automations **reliable, inspectable, and boring** — even when the outside world is not.
