# 07. Workflow Operations

This chapter defines **user-facing operations** for managing workflow execution: actions on events, actions on runs, and behavior across script versions.

These operations preserve the delegation contract: users resolve uncertainty about the external world, not internal logic. All actions are explicit, auditable, and maintain full traceability.

---

## User Actions on Events

Users can manage events through the UI:

* **Skip event** — mark event as `skipped`, excluded from future processing

Skipping is permanent within the current workflow version. Skipped events remain visible in the UI for observability but will not be reserved by future consumer runs.

---

## User Actions on Runs

When a run enters a blocked state requiring user action (see Chapter 06 "Run Lifecycle" and Chapter 13 "Escalation"):

* **Try again** — retry reconciliation for an indeterminate mutation (only available if the mutation has a `reconcile` method; see Chapter 13)
* **It didn't happen** — user asserts mutation did not commit; marks mutation `failed`, allowing `mutate` to re-execute
* **Skip** — `next` executes with `mutationResult.status = 'skipped'`, reserved events marked `skipped`

### Try Again

Available only when the mutation has a `reconcile` method. Resets the reconciliation attempt counter and returns the mutation to `needs_reconcile` state. The host will attempt reconciliation again with backoff.

Use when: external system was temporarily unavailable but may now respond correctly.

### It Didn't Happen

User asserts with confidence that the mutation did not commit in the external system. The mutation is marked `failed`, and the `mutate` handler re-executes with the same PrepareResult.

Use when: user has verified in the external system that the mutation did not occur.

**Warning**: If the mutation actually did occur, re-executing will cause a duplicate.

### Skip

Abandons the mutation attempt entirely. The `next` phase executes with `mutationResult.status = 'skipped'`, and reserved events are marked `skipped`.

Use when: the mutation is no longer needed or the user wants to move past the blocked state without resolving it.

---

## Version Changes

### Minor Version Changes (Repairs)

When Maintainer repairs a script (increments minor version):

* All topic and event state is preserved
* Pending events continue processing under the new script
* Consumed events remain consumed
* Skipped events remain skipped

Repairs are transparent to the event queue — the workflow continues from where it left off.

### Major Version Changes (Re-planning)

When intent changes and Planner generates a new major version:

* Event records remain in topics (for observability and history)
* Consumed events remain consumed
* Pending events continue processing under the new script

In v1, there is no automatic reprocessing of consumed events on major version changes. Users who need to reprocess historical data should use external mechanisms or wait for v2 reprocessing support.

---

## Delegation Contract

The operations defined in this chapter maintain the delegation contract:

* Users resolve uncertainty about **external system state** (did it happen?)
* Users do not resolve **internal logic errors** (those go to Maintainer or escalation)
* All actions are **explicit** — no silent retries or automatic resolution
* All actions are **auditable** — recorded in run history with timestamps
* All actions preserve **traceability** — the connection between inputs, mutations, and outcomes remains queryable

---

## Summary

Workflow operations give users control over:

* Skipping events they don't want processed
* Resolving blocked runs when mutations have uncertain outcomes
* Understanding how version changes affect event processing

These operations are the user-facing complement to the execution model (Chapter 06) and reconciliation mechanics (Chapter 13).
