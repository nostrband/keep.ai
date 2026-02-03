# 20. v2 Roadmap

> **Status**: This chapter describes features not included in v1. It is provided for planning purposes and to document design direction.

---

## Workflow-Scoped KV Store

### Motivation

v1 provides handler-local state through functional return values (see Chapter 06, "Handler State"). Some use cases may require shared state across handlers:

* Global rate limit counters (e.g., "max 100 API calls per hour across all handlers")
* Deduplication caches shared between producers
* Configuration values that affect multiple handlers

### Proposed Design

A workflow-scoped KV store accessible to all handlers:

```js
// In any handler
const globalCounter = await ctx.workflow.kv.get("api_calls_today");
await ctx.workflow.kv.set("api_calls_today", globalCounter + 1);
```

### Considerations

* **Concurrency** — With v1's single-threaded execution, no conflicts arise. If v2 enables parallel handlers, KV operations would need atomic increments or optimistic locking.
* **Atomicity** — Should workflow KV writes be atomic with handler completion? Or fire-and-forget?
* **Scope creep** — Most "shared state" needs are better modeled as topics. Workflow KV should remain a narrow escape hatch, not a general-purpose database.

### Alternative

Many shared-state patterns can be modeled as internal topics with a "state accumulator" consumer. This keeps data flow explicit and observable. Workflow KV may be unnecessary if topic patterns prove sufficient.

---

## Event Reprocessing

### Motivation

Users may need to reprocess events that were previously consumed:

* A bug was fixed and historical items should be re-run through the corrected logic
* External state changed and the mutation should be re-applied
* User wants to test changes against real historical data

### Reprocess Action

**Reprocess event** — mark a `consumed` or `skipped` event back to `pending`.

When an event is reprocessed:

1. `status` is set to `pending`
2. `reserved_by` is cleared
3. Event becomes eligible for the next consumer run

---

## Attempt Tracking

### Motivation

When events can be reprocessed multiple times, full traceability requires linking each processing run to a specific "attempt" of the event.

### Mechanism

Each event has an `attempt_id` (host-managed, not exposed to scripts):

* Starts at 1 when event is created
* Incremented each time the event is reprocessed

When the host persists reservations during `prepare`, it captures the **current `attempt_id`** of each reserved event. This creates a durable link:

* Run R1 reserves event E at `attempt_id: 1` → R1's mutation is linked to attempt 1
* User reprocesses E → E's `attempt_id` becomes 2
* Run R2 reserves event E at `attempt_id: 2` → R2's mutation is linked to attempt 2

### Queryability

Given an event, all runs that processed it can be retrieved, each tagged with the attempt they processed. This enables:

* "Show me all runs that processed this email"
* "What happened in the first attempt vs the second?"
* "Which runs were affected by the bug that was fixed in v1.3?"

### Script Invariant

Scripts must behave identically regardless of attempt number. The `attempt_id` is purely for observability and audit — it is never exposed to script logic.

---

## Major Version Reprocessing

When Planner generates a new major version (intent changed), the system may prompt the user:

**"Your workflow changed. Do you want to reprocess previously completed events?"**

User options:

* **Start fresh** — all consumed events marked `pending`, `attempt_id` incremented for each
* **Keep progress** — consumed events remain consumed (same `attempt_id`)
* **Select events** — user manually selects which events to reprocess (`attempt_id` incremented for selected)

In all cases, previous processing history remains queryable via the runs that captured earlier `attempt_id` values.

---

## Event ID Compatibility

### Problem

A major version may change the **event identity format**:

* v1 uses `email:<message_id>`
* v2 uses `thread:<thread_id>`

Old and new events are disjoint — the consumer cannot correlate them.

### Detection

The system detects event ID format changes by comparing:

* Schema of `messageId` patterns in old vs new script
* Actual events in topics vs what new producer would generate

### User Warning

Before activation, the system warns:

> "Event format changed. Existing events will become orphaned."

The UI lists orphaned events for review.

### Orphan Resolution

After activation, orphaned events (those with IDs that don't match the new format) are flagged. User options:

* **Keep as history** — events remain visible but permanently `consumed` (not processable)
* **Delete** — remove orphaned events from topic
* **Migrate** — (if feasible) transform old events to new format

Migration is complex and may not be automatable. In most cases, users will choose to keep orphaned events as historical records and let the new version start fresh.

---

## Implementation Notes

### Attempt Counter Storage

The `attempt_id` is stored per-event in the topic. Incrementing it is atomic with the status change to `pending`.

### Reservation Capture

Reservations must store `{ messageId, attempt_id }` tuples, not just `messageId`. This is checked during commit to detect stale reservations (event was reprocessed while run was suspended).

### Stale Reservation Handling

If a run tries to commit but the event's `attempt_id` has changed since reservation:

* The commit fails
* Run is marked as `stale`
* User is notified that the event was reprocessed while the run was in progress
* Reserved events are released
* No automatic retry — user decides what to do

---

## LLM-Assisted External State Repair

### Motivation

Keep.AI provides LLM assistance for code problems:

* **Maintainer** — autonomously repairs logic errors in scripts
* **Planner** — interactively helps users adjust intent

But when **external state** becomes inconsistent — due to bugs that caused incorrect mutations, version changes, partial failures, or user errors in external systems — the user is currently left to fix it themselves.

This is a significant gap. The LLM has full visibility into:

* Run history and logs
* What mutations were attempted vs applied
* What the script intended to do
* What the external system's current state is (via read operations)

With this context, an LLM can often diagnose what went wrong and suggest precise fixes in seconds — work that would take a user significant time to piece together manually.

### Proposed Capability

When a user encounters external state problems, they can invoke an **LLM-assisted repair session**:

1. User describes the problem ("these rows have wrong values", "emails were sent to wrong recipients")
2. LLM reviews relevant run logs, mutation records, and current external state
3. LLM explains what likely went wrong and when
4. LLM proposes specific remediation actions (update these rows, send correction emails, etc.)
5. User reviews and approves proposed fixes
6. System executes approved fixes as tracked mutations

### Key Properties

* **Diagnostic, not autonomous** — LLM proposes, user approves. No automatic "fixing" of external state.
* **Full audit trail** — repair actions are logged as explicitly as regular mutations
* **Bounded scope** — repair session focuses on specific identified problems, not open-ended "make it right"
* **Trust reinforcement** — users see that the system can help them recover, not just fail and leave them stranded

### Example Scenarios

**Bug caused duplicate rows:**
> "Maintainer fixed a bug where emails were processed twice. 47 duplicate rows were created in Sheet X between Jan 5-7. Here are the duplicates. Shall I delete them?"

**Partial failure left inconsistent state:**
> "Run #1234 created a Notion page but failed before updating the tracking sheet. The page exists but isn't tracked. Shall I add the missing row to the sheet?"

**Version change broke ID format:**
> "After the workflow update, 12 events became orphaned because message IDs changed format. I can either mark them as skipped, or reprocess them under the new format. Which would you prefer?"

### Considerations

* **Read access** — repair sessions need read access to external systems to diagnose state. This may require additional permissions.
* **Write access** — proposed fixes require mutation permissions. Should repair use the same permission model as regular execution?
* **Scope limits** — how to prevent repair sessions from becoming open-ended debugging? Time/cost budgets?
* **Confidence levels** — LLM should indicate certainty ("definitely duplicates" vs "possibly related to the bug")

### Relationship to Delegation Contract

This feature reinforces the delegation contract rather than weakening it:

* User remains in control — all fixes require explicit approval
* System takes responsibility for helping users recover from problems it may have caused
* Full transparency into what went wrong and why
* Repair actions are as auditable as regular execution

Rather than "fire and forget with fingers crossed," users get a partner that helps them understand and fix problems when they occur.

---

## Open Questions

* Should reprocessing be available for events currently reserved by a suspended run?
* How to handle reprocessing during active reconciliation?
* Should there be bulk reprocessing controls (e.g., "reprocess all events from the last 24 hours")?
* How to surface "blast radius" when a bug affected multiple attempts?
* Is workflow-scoped KV necessary, or can all use cases be modeled as topics?
* How should LLM-assisted repair sessions be scoped and budgeted?
* Should repair actions use the same permission model as regular execution?

---

## Summary

v2 features under consideration:

* **Workflow-scoped KV** — shared state across handlers (if topic patterns prove insufficient)
* **Event reprocessing** — re-run historical events through updated logic
* **Attempt tracking** — full lineage of which run processed which attempt
* **Version migration** — tools for handling event ID format changes
* **LLM-assisted state repair** — diagnose and fix external state problems with user approval

These features add complexity and are deferred to v2 to keep v1 focused on core correctness guarantees.
