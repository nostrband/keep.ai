# 17. Inputs & Outputs

This chapter defines how users view and manage workflow execution through the UI.

---

## Principles

1. **Inputs and outputs** — users think in terms of "what came in" and "what happened," not internal workflow structure
2. **External boundaries only** — the UX exposes inputs (from Input Ledger) and outputs (mutations), not internal topics, consumers, or phases
3. **Causal traceability** — users can see what outputs resulted from what inputs
4. **Minimal actions** — v1 provides only essential operations
5. **Delegation contract** — actions resolve external uncertainty, not internal logic

---

## Inputs→Outputs Model

The primary workflow view is organized around **inputs** (what the system received) and **outputs** (what the system did), not internal events or runs.

This aligns with:
* The delegation contract (users express intent, system handles implementation)
* The intent spec structure (inputs/outputs, not workflow graphs)
* How users naturally think ("what happened to my email?")

### What Users See

| Concept | Internal Representation | User-Facing Name |
|---------|------------------------|------------------|
| External input | Input Ledger entry | Shown by source/type (e.g., "Gmail Emails") |
| Consumer mutation | Mutation ledger entry | Output |
| Workflow event | Event in topic | (hidden) |
| Consumer run | Run record | (hidden unless blocked) |

Inputs come from the **Input Ledger** (see Chapter 06a), not from events. The Input Ledger contains user-facing metadata (source, type, title). Events are internal workflow coordination and don't appear in the primary UI.

Since we know the source and type of each input, the UI shows meaningful labels like "Gmail Emails" or "Slack Messages" rather than generic "Inputs".

---

## Dashboard View

The workflow overview shows inputs and outputs at a glance:

```
My Email Processor
━━━━━━━━━━━━━━━━━━

Status: Running ✓
Last activity: 2 minutes ago

Inputs
└─ Gmail Emails: 47 pending, 1,203 done

Outputs
├─ Sheets: 1,156 rows created
└─ Slack: 47 notifications sent

⚠ 2 inputs need your attention
```

**What this shows:**
* Inputs — grouped by source/type (from Input Ledger), with pending/done counts
* Outputs — grouped by connector/target (derived from mutation ledger; each connector provides display info)
* Action-needed count for blocked inputs

**What this hides:**
* Internal topics
* Consumer names
* Run IDs and phases

---

## Inputs View

Clicking an input source (e.g., "Gmail Emails") shows inputs of that type:

```
┌─────────────────────────────────────────────────────────────┐
│ Gmail Emails                                      [Filter ▾]│
├─────────────────────────────────────────────────────────────┤
│ ● Email from alice@example.com: "Q4 Report"        pending  │
│ ● Email from bob@example.com: "Invoice #1234"      pending  │
│ ✓ Email from carol@example.com: "Meeting notes"    done     │
│ ✓ Email from dave@example.com: "Project update"    done     │
│ ⊘ Email from spam@example.com: "Buy now!"          skipped  │
└─────────────────────────────────────────────────────────────┘
```

Inputs are displayed by their title (from Input Ledger). The title should contain enough context for users to recognize what the input is.

Status indicators:
* `●` pending — has unprocessed downstream work
* `✓` done — all downstream work complete
* `⊘` skipped — manually skipped by user

### Pending Status Computation

An input is "pending" if **any event referencing it** has unfinished work:

```
Input I1 → Event E1 (caused_by: [I1]) → Event E2 (caused_by: [I1], not yet consumed)
```

I1 shows as "pending" because E2 references it and E2 is not yet consumed.

This uses the `caused_by` field on events (see Chapter 06a):
```
pending(input) = exists event E where input.inputId in E.caused_by
                 and E.status = 'pending'
                 or E.reserved_by is not null
```

An event is considered unfinished if it's `pending` (awaiting processing) or currently reserved by an active run (`reserved_by` is set).

---

## Input Detail

Clicking an input shows what happened to it:

```
Email from alice@example.com: "Q4 Report"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: Gmail / Email
Status: Done ✓
Received: Jan 15, 2025 at 2:34 PM

What happened:
  ✓ Row added to "Reports" sheet          Jan 15 at 2:35 PM
  ✓ Notification sent to #finance         Jan 15 at 2:35 PM
```

**What this shows:**
* The input's title (from Input Ledger)
* The input's source and type (e.g., "Gmail / Email")
* All mutations that resulted from this input (traced via `caused_by` on events → mutation ledger)
* Mutation descriptions (semantic title from `prepareResult.ui.title`)
* Mutation parameters (formatted by host from actual call, not script-declared)

**Zero outputs:** If an input was processed but no mutations occurred (e.g., routing-only consumers), it shows "Done ✓" with "What happened: No external changes".

**What this hides:**
* Internal workflow events
* Consumer names and run IDs
* Phase details

### Trust Boundary

Scripts are untrusted code. The `ui.title` is a semantic hint that cannot be fully trusted. The actual mutation parameters shown to users are formatted by the **host** from the observed mutation call, not from script-declared metadata. This ensures users see what was actually attempted.

### Fan-out Display

When one input causes multiple mutations:

```
What happened:
  ✓ Row added to "Reports" sheet
  ✓ Notification sent to #finance
  ✓ Calendar event created
```

All mutations are listed under the input that caused them.

### In-Progress Display

When work is still in progress:

```
What happened:
  ✓ Row added to "Reports" sheet          Jan 15 at 2:35 PM
  ● Notification to #finance              processing...
```

---

## Outputs View

Users can alternatively browse by output type:

```
┌─────────────────────────────────────────────────────────────┐
│ Outputs: Sheets rows                              [Filter ▾]│
├─────────────────────────────────────────────────────────────┤
│ ✓ Row added for alice@example.com      ← "Q4 Report"        │
│ ✓ Row added for bob@example.com        ← "Invoice #1234"    │
│ ⚠ Row added for dan@example.com        ← "Budget"  (unconfirmed) │
│ ✓ Daily summary row                    ← 5 emails (batch)   │
└─────────────────────────────────────────────────────────────┘
```

Each output shows:
* Mutation description (from `prepareResult.ui.title`)
* Link back to the input(s) that caused it
* Status: `✓` confirmed, `⚠` indeterminate (needs reconciliation)

**What appears here:**
* Completed mutations (from mutation ledger)
* Indeterminate mutations awaiting reconciliation
* Failed mutation attempts appear only in the Details View (run history), not here

**Fan-in display:** When a mutation was caused by multiple inputs (batch/digest), the link shows the count: "← 5 emails (batch)". Clicking expands to show all contributing inputs.

---

## Filters

Both Inputs and Outputs views support filtering:

* **Status**: pending / done / skipped / all
* **Time range**: last hour / today / this week / all time
* **Search**: text search in titles

Default: pending first, then recent done.

---

## User Actions on Inputs

### Skip Input

Mark an input as `skipped`. It will not be processed further.

**Use cases:**
* Spam or irrelevant inputs
* Test data that shouldn't be processed
* Inputs handled manually outside the system

**Action**: Click input → "Skip" button → Confirm

### Skip Semantics

Skipping an input **prevents future work** but **does not undo completed work**.

**Input Ledger changes:**
```
status: 'active' → 'skipped'
skipped_at: <timestamp>
```

**Effect on events referencing this input (`caused_by` contains this inputId):**

| Event State | Behavior |
|-------------|----------|
| `pending` (not reserved) | Marked `skipped` |
| `reserved` (pre-mutation) | Run aborted, event marked `skipped` |
| `reserved` (post-mutation) | Run completes, event marked `consumed` |
| `consumed` | Unchanged — work already done |

**Batch/digest handling:**

If a reservation includes events from multiple inputs (e.g., batch processing), and one input is skipped:
* Pre-mutation: entire run is aborted, all reserved events released
* On re-run, `peek()` excludes events from skipped inputs
* Consumer re-prepares with remaining events only

**Correlation handling:**

If a consumer is waiting to correlate events from multiple inputs (e.g., email + approval), and one input is skipped:
* The skipped input's events are marked `skipped`
* Remaining events may become orphaned (correlation never completes)
* These show as stale and can be individually skipped or investigated

**Partial skip display:**

If some outputs were already created before skip:
* Input shows as `skipped`
* UI indicates: "Skipped (2 outputs completed before skip)"
* Completed outputs remain visible in the outputs view

### No Other Actions in v1

v1 does not support:
* **Reprocess** — re-run completed inputs
* **Edit** — modify input payload
* **Delete** — remove inputs from history

Inputs are append-only and immutable. This preserves auditability.

---

## Blocked Work Indicator

When a mutation is blocked (awaiting user action), prominent UI shows:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ ACTION REQUIRED                                           │
│                                                             │
│ Could not confirm: Send email to client@example.com         │
│ Input: Email from alice@example.com: "Q4 Report"            │
│                                                             │
│ The system couldn't verify if the email was sent.           │
│                                                             │
│ What happened?                                              │
│ [Try Again]  [It Didn't Happen]  [Skip]                     │
└─────────────────────────────────────────────────────────────┘
```

**What this shows:**
* Mutation title (semantic, from `prepareResult.ui.title`)
* Mutation parameters (actual, formatted by host from observed call)
* The input that triggered this work
* Plain-language explanation of the problem
* Resolution options

**What this hides:**
* Run IDs, phases, consumer names
* Internal implementation details

The mutation title ("Send email to client@example.com") is script-declared and may not fully match the actual call. For verification, users can expand to see the actual parameters the host observed.

Action semantics are defined in Chapter 07.

---

## Stale Input Warnings

Inputs pending longer than threshold (default: 7 days) are flagged:

```
⚠ Email from old@example.com: "Ancient message"    pending 12 days
```

This may indicate:
* Correlation waiting for data that will never arrive
* Bug in workflow logic
* Workflow paused and forgotten

**User actions:**
* **Investigate** — view input details
* **Skip** — mark as skipped if no longer relevant
* **Resume workflow** — if workflow was paused

---

## Run History (Details View)

For support escalations or when users want to investigate unexpected behavior, a secondary view shows internal details:

```
┌────────────────────────────────────────────────────────────┐
│ Recent Runs                                       [Details] │
├────────────────────────────────────────────────────────────┤
│ #1848  processEmail   committed  2 min ago                 │
│ #1847  processEmail   committed  5 min ago                 │
│ #1846  pollEmail      committed  5 min ago                 │
│ #1845  processEmail   failed     12 min ago    ⚠           │
└────────────────────────────────────────────────────────────┘
```

This view is not the primary interface. It exists for:
* Support escalations (sharing run details with support)
* Investigating suspicious behavior (pausing workflow, reporting issues)
* Verifying what the system did

Users observe and report — they do not fix. The system owns repair.

The primary UX remains Inputs→Outputs.

---

## Prompting Guidance

For LLMs generating workflow code, these UX requirements translate to prompting constraints:

### Input Registration

* **One external input = one registration**: Each email, message, or record gets one `registerInput` call
* **Titles describe the input**: "Email from alice@example.com: Subject" not "Input #5"
* **Include identifiers**: Subject lines, sender addresses, record IDs — things users recognize
* **Use correct source/type**: Match the connector (gmail/email, slack/message, etc.)

### Consumer PrepareResult (Outputs)

* **Always provide `ui.title`**: "Add row for alice@example.com" not "Execute mutation"
* **Describe user impact**: What will change in the external world
* **Include key identifiers**: Email addresses, record names — things users recognize
* **Do not preview actual data**: The host formats mutation parameters from observed calls

### Events

* Events are internal workflow coordination — no user-facing metadata needed
* Only Inputs (from Input Ledger) and mutations are shown to users

---

## Summary

The Inputs & Outputs UX provides:

* **Inputs→Outputs navigation** — organized around external boundaries, showing source/type labels
* **Causal traceability** — see what outputs resulted from what inputs
* **Hidden implementation** — internal topics, consumers, runs are not primary UI
* **Pending rollup** — input is pending if any downstream work is pending
* **Minimal actions** — skip inputs, resolve blocked mutations
* **Details view available** — internal run history accessible for investigation and support

This design keeps users oriented around their actual work (what came in, what happened) while preserving the delegation contract (system owns implementation details).

---

## Related Chapters

* Chapter 06a — Topics and Handlers (Input Ledger, causal tracking)
* Chapter 06b — Consumer Lifecycle (prepareResult.ui field)
* Chapter 07 — Workflow Operations (action semantics)
