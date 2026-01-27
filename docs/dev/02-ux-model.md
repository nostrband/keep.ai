# UX Model: Surfaces, States, and Responsibility

This document explains how Keep.AI’s philosophy of **delegation over authorship** is expressed in the user experience.

The UX is not just presentation — it is a **contract**.
Every surface, state, and interaction is designed to preserve system responsibility and avoid silently shifting maintenance back to the user.

---

## UX principles (derived from philosophy)

The UX must enforce the following principles:

1. **Intent over implementation**
   Users express *what they want*, not *how it works*.

2. **Observability without maintainership**
   Users can see what happens, but are not expected to debug or repair.

3. **Explicit responsibility boundaries**
   When human action is required, the system must say so clearly and stop.

4. **Few, strong states instead of many weak ones**
   Ambiguous “half-working” states are avoided.

5. **No hidden control surfaces**
   If something looks editable, it implies responsibility.

These principles are reflected in the UX surfaces described below.

---

## Primary UX surfaces

Keep.AI exposes a small number of deliberate surfaces instead of a single “do everything” interface.

### 1) Automations view

**Purpose:**
Manage *what exists* and *what is running*, not *how it is implemented*.

**What this surface shows:**

* list of automations
* high-level status (running / paused / needs action / failed)
* last run summary
* next scheduled run (if applicable)
* cost/resource indicators (high-level)

**What this surface explicitly does not show:**

* workflow graphs
* implementation steps
* editable logic

**Allowed actions:**

* create new automation (intent entry)
* pause / resume
* disable
* delete
* update intent (via natural language)

**Placeholder:**
Map this to actual UI components and DB entities (e.g. `tasks`, `workflows`).

---

### 2) Intent input and modification

**Purpose:**
Capture and evolve *what the automation should do*, not its structure.

**Initial creation:**

* user provides a natural-language description
* system may ask clarifying questions
* intent is confirmed before activation

**Modification:**

* intent changes are additive or corrective
* examples:

  * “Also include X”
  * “Run weekly instead”
  * “Ignore this edge case”
* no direct editing of scripts or steps

**Design constraint:**
Any UI that allows direct manipulation of implementation details is considered a violation of delegation.

**Placeholder:**
Describe how intent is stored and versioned internally (e.g. intent records, revisions).

---

### 3) Run history view

**Purpose:**
Provide confidence and auditability without inviting debugging.

**What it shows:**

* chronological list of runs
* outcome (success / failed / paused)
* duration
* high-level summary (“processed 12 emails”, “posted 3 messages”)
* cost breakdown

**Expandable details (read-only):**

* tool calls
* logs
* timestamps
* error classification

**What it avoids:**

* “edit this step” affordances
* inline fix buttons
* partial execution toggles

> This view answers: *“Did it work?”*
> Not: *“How do I fix it myself?”*

**Placeholder:**
Map to run/event tables and log schemas.

---

### 4) Notifications & “Action needed” inbox

**Purpose:**
Handle the only legitimate form of human involvement: **external unblockers**.

Examples:

* OAuth token expired
* missing permission
* required approval
* ambiguous or unsafe condition

**Design rules:**

* an automation pauses when action is required
* the notification must be explicit and specific
* the system must not retry blindly
* after the action is taken, the automation resumes deterministically

**Action-needed items must include:**

* what is blocked
* why the system cannot proceed
* exactly what action is required
* what will happen after resolution

**This is not a chat.**
It is a structured, resumable system state.

**Placeholder:**
Describe notification types, pause semantics, and resume mechanics.

---

### 5) Chat interface (user-facing)

**Purpose:**
Natural language is the control plane, not the execution plane.

**Valid uses:**

* creating automations
* modifying intent
* asking for explanations (“Why did this fail?”)
* reviewing summaries

**Invalid uses:**

* running live execution logic
* step-by-step debugging
* issuing imperative commands mid-run

**Important distinction:**
Chat is *not* an agent controlling execution.
It is a conversational UI for intent and explanation.

**Placeholder:**
Explain how chat messages are routed internally (e.g. inbox delivery to tasks).

---

### 6) Cost and resource visibility

**Purpose:**
Enable trust and safe delegation.

**Shown to users:**

* per-automation cost trends
* per-run costs
* major cost drivers (LLM, API calls, etc.)

**Not shown:**

* raw token-level noise by default
* internal retries unless relevant

**Design intent:**
Users should be able to say:

> “This automation costs too much”
> without needing to understand *why it was implemented that way*.

**Placeholder:**
Describe cost accounting sources and aggregation logic.

---

## UX states and lifecycle

Automations move through a small, explicit set of states.

### Core states

* **Active** – running as expected
* **Paused** – manually paused by user
* **Needs action** – blocked on human input
* **Failed (safe)** – stopped due to unsafe or unrecoverable condition
* **Disabled** – permanently stopped

There is intentionally no “degraded but still running” state.

**Placeholder:**
List exact state enum and transitions.

---

### Failure handling in UX

Failures are not hidden or auto-dismissed.

The UX must:

* classify the failure
* explain it in plain language
* show what the system is doing (retrying / repairing / waiting)
* surface human responsibility explicitly when required

**Anti-patterns we avoid:**

* infinite retries with no explanation
* silent partial success
* dumping raw stack traces without context

---

## Control-only clients (web / mobile)

**Purpose:**
Allow monitoring and intervention without increasing blast radius.

**Capabilities:**

* view automations
* view run history
* receive notifications
* perform action-needed steps
* pause/disable automations

**Explicit limitations:**

* no script editing
* no connector configuration beyond approval flows
* no runtime mutation

This keeps remote access safe while preserving delegation.

**Placeholder:**
Describe E2EE control channel and client capability matrix.

---

## UX anti-goals (explicit)

The following are intentionally **not** part of the UX:

* visual workflow editors
* step-by-step execution toggles
* “fix this step” buttons
* hidden advanced modes that expose implementation
* dual control paths (UI + code) for the same responsibility

These patterns reintroduce authorship and are considered architectural violations.

---

## Implications for contributors

When proposing UX changes, contributors should ask:

* Does this UI affordance imply user responsibility?
* Does it encourage manual fixing instead of system repair?
* Does it create an ambiguous ownership boundary?
* Could a user reasonably think: “Now this is my problem”?

If yes, the design likely conflicts with Keep.AI’s philosophy.

---

## Summary

Keep.AI’s UX is intentionally constrained.

Those constraints:

* preserve delegation
* protect system-owned maintenance
* prevent accidental reintroduction of builder workflows

The UX does not exist to make automation *fun to tinker with*.
It exists to make automation *safe to forget*.

