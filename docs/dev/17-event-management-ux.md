# 17. Event Management UX (Draft)

> **Status**: Draft proposal for v1. Requires review and refinement.

This chapter defines how users view and manage events through the UI.

---

## Principles

1. **Events are primary** — users think in terms of "what happened to my email," not "what did run #1234 do"
2. **Full visibility** — users can see all events and their status
3. **Minimal actions** — v1 provides only essential operations
4. **Delegation contract** — actions are explicit and auditable

---

## Event-Centric View

The primary workflow view is organized around **events**, not runs.

### Topic List

Users see their workflow's topics:

```
email.received     47 pending, 1,203 consumed
row.created        0 pending, 1,156 consumed
```

### Event List

Clicking a topic shows events:

```
┌─────────────────────────────────────────────────────────────┐
│ email.received                                    [Filter ▾]│
├─────────────────────────────────────────────────────────────┤
│ ● Email from alice@example.com: "Q4 Report"      pending    │
│ ● Email from bob@example.com: "Invoice #1234"    pending    │
│ ✓ Email from carol@example.com: "Meeting notes"  consumed   │
│ ✓ Email from dave@example.com: "Project update"  consumed   │
│ ⊘ Email from spam@example.com: "Buy now!"        skipped    │
└─────────────────────────────────────────────────────────────┘
```

Status indicators:
* `●` pending — awaiting processing
* `✓` consumed — successfully processed
* `⊘` skipped — manually skipped by user

### Event Detail

Clicking an event shows:

* **Title** and **payload** (the event data)
* **Status** and status history
* **Created by** — which producer run created this event
* **Processing history** — which consumer run(s) processed it, with outcomes

```
Email from alice@example.com: "Q4 Report"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: consumed
Created: Jan 15, 2025 at 2:34 PM by producer run #1201

Payload:
  from: alice@example.com
  subject: Q4 Report

Processing History:
  Run #1847 — Jan 15 at 2:35 PM — committed
    → Created row in "Reports" sheet
    → Emitted: row.created (row:q4-report-alice)
```

---

## Event Filters

Users can filter the event list:

* **Status**: pending / consumed / skipped / all
* **Time range**: last hour / today / this week / all time
* **Search**: text search in titles

Default view: pending events first, then recent consumed.

---

## User Actions on Events

### Skip Event

Mark a pending event as `skipped`. It will not be processed.

Use cases:
* Spam or irrelevant items
* Test data that shouldn't be processed
* Events that were handled manually outside the system

**Action**: Click event → "Skip" button → Confirm

**Result**: Event status becomes `skipped`. Auditable record created.

### No Other Actions in v1

v1 does not support:
* **Reprocess** — re-run consumed events (see Chapter 20)
* **Edit** — modify event payload
* **Delete** — remove events from history

Events are append-only and immutable. This preserves auditability.

---

## Stale Event Warnings

Pending events that remain unprocessed for extended periods may indicate problems:

* Correlation that will never arrive
* Bug in consumer logic
* Workflow paused and forgotten

### Warning Thresholds

Events pending longer than threshold (default: 7 days) are flagged:

```
⚠ Email from old@example.com: "Ancient message"    pending 12 days
```

### Stale Event Actions

Users can:
* **Investigate** — view event details, check why it wasn't processed
* **Skip** — mark as skipped if it's no longer relevant
* **Resume workflow** — if the workflow was paused

---

## Run History (Secondary View)

While events are primary, users can also view runs:

### Run List

```
┌────────────────────────────────────────────────────────────┐
│ Recent Runs                                                │
├────────────────────────────────────────────────────────────┤
│ #1848  consumer:processEmail  committed  2 min ago         │
│ #1847  consumer:processEmail  committed  5 min ago         │
│ #1846  producer:pollEmail     committed  5 min ago         │
│ #1845  consumer:processEmail  failed     12 min ago    ⚠   │
└────────────────────────────────────────────────────────────┘
```

### Run Detail

Shows:
* Handler name and type
* Status and duration
* Events reserved (for consumers)
* Mutation attempted and outcome
* Events emitted
* Error details (for failed runs)

---

## Blocked Run Indicator

When a run is suspended (awaiting user action), prominent UI shows:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ ACTION REQUIRED                                           │
│                                                             │
│ Run #1849 is waiting for your decision.                    │
│                                                             │
│ Mutation: Send email to client@example.com                 │
│ Status: Could not confirm delivery (timeout)               │
│                                                             │
│ What happened?                                              │
│ [Try Again]  [It Didn't Happen]  [Skip]                    │
└─────────────────────────────────────────────────────────────┘
```

This links to Chapter 07 (Workflow Operations) for action semantics.

---

## Notifications

Users receive notifications for:

* **Workflow paused** — failure or indeterminate mutation requires action
* **Stale events** — pending events exceed warning threshold
* **Sustained errors** — multiple consecutive failures

Notification channels (email, push, etc.) are configured per-user.

---

## Dashboard Summary

The workflow overview shows:

```
My Email Processor
━━━━━━━━━━━━━━━━━━

Status: Running ✓
Last run: 2 minutes ago
Next producer run: in 3 minutes

Topics:
  email.received    47 pending
  row.created       0 pending

Recent Activity:
  ✓ 12 emails processed today
  ⚠ 3 events pending > 7 days
```

---

## Summary

The event management UX provides:

* **Event-centric navigation** — topics → events → details
* **Clear status visibility** — pending, consumed, skipped with visual indicators
* **Minimal actions** — skip is the only event action in v1
* **Stale event warnings** — surface events that may need attention
* **Run history** — secondary view for debugging
* **Blocked run prompts** — clear calls to action when user input needed

This design keeps users oriented around their actual work items (events) while providing the information needed to understand and manage workflow execution.
