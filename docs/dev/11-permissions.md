# Permissions, Grants, and Enforced Policy

This document defines how Keep.AI controls **what automations are allowed to do**.

Permissions are a **host-level enforcement mechanism**. They are independent from the Intent Spec and exist even if automations were authored entirely by humans.

Their role is to provide deterministic safety guarantees, clear user consent, and predictable runtime behavior.

---

## Design principles

1. **Host-enforced, not LLM-enforced**
   Permissions are enforced by the runtime. LLMs may propose them, but cannot grant or bypass them.

2. **Outside the programming model**
   Scripts do not request or manage permissions. They either have the required grants or they fail.

3. **Stable envelope across repairs**
   Auto-repairs cannot silently expand the envelope.

4. **Explicit user consent**
   Any expansion of permissions requires user approval.

5. **Least surprise over least privilege**
   In early versions, stable and understandable permissions are preferred over fragile ultra-minimal scopes.

---

## Terminology

* **Permission**: A capability class (e.g. `gmail.read`, `slack.post`).
* **Grant**: A permission approved for a specific workflow version, possibly scoped.
* **Policy**: The full enforced envelope: grants + limits + budgets.
* **Scope**: Optional resource restriction within a permission (e.g. label, channel).
* **Risk tier**: Classification of how dangerous misuse would be.

---

## Permission envelopes

Each workflow **major version** has an associated permission envelope.

* The envelope is immutable once approved.
* Any changes to the envelope require approval and are recorded as a new version.
* Repairs operate strictly within the existing envelope.
* Intent changes create a new major version and may request a new envelope.

This ensures:

* predictable runtime behavior
* no silent authority expansion
* clear audit history

Script versions track *what the automation does*.
Permission envelopes track *what it is allowed to do*.

This separation avoids accidental authority expansion while keeping version histories meaningful.

---

## Planner vs production permissions

Keep.AI distinguishes between:

### Planner session permissions

* Ephemeral
* Bound to a planning session or chat
* Used for exploration and testing
* May prompt the user interactively
* Never reused by production runs

### Production workflow permissions

* Persistent
* Explicitly approved by the user
* Enforced for all executions and repairs
* Visible in workflow settings

Planner access does **not** imply production authority.

---

## Tool-declared permission schemas

Every tool must declare a permission schema.

A schema defines:

* Capability name (e.g. `gmail.read`)
* Risk tier (`low`, `medium`, `high`)
* Optional scope dimensions (if enforceable)
* Whether scoping is enforceable or informational
* Enforcement hook used by the runtime

This makes permission reasoning explicit, reviewable, and extensible.

---

## Permission compilation

Permissions are not authored by the planner.

Instead, after a script is saved by planner, the host performs **permission compilation** and permission requests are passed to user for approval before script deployment.

### Inputs

* Script source code
* Intent Spec
* Workflow schedule (frequency, triggers)
* Tool permission schemas

### Process

1. Identify which tools are used
2. Determine required capability classes
3. Propose scopes and limits where possible
4. Flag uncertainty and risk

An LLM may assist in this step, but the host validates all results.

Planner session permissions are handled through the same pipeline, with grants saved to an ephemeral permission envelope assigned to the session.

---

## LLM-assisted permission proposals

LLMs may propose:

* Resource scopes (labels, channels, folders)
* Budgets and rate limits
* Safety defaults based on intent

However:

* LLM output is treated as **suggestions**
* The host validates, narrows, or rejects proposals
* High-risk or broad requests require explicit confirmation

LLMs do not see the currently granted permissions to avoid gaming.

---

## User approval flow

Permission changes are presented as OS-style prompts:

* Clear list of requested capabilities
* Scopes and limits where applicable
* Risk warnings for dangerous permissions
* Explicit diff vs previous version

Examples:

* "This automation can read Gmail"
* "This automation can post to Slack channel #ops"
* "This automation can send up to $100/day"

High-risk permissions may require additional confirmation.

---

## Limits and budgets

Permissions may include enforced limits:

* Side effects per run
* Side effects per day/week
* Token or API budgets
* Runtime ceilings

Limits are defined in **stable environmental units**, not per-run guesses.

They exist to:

* bound blast radius
* prevent repair storms
* make costs predictable

---

## Missing permissions at runtime

If a script attempts an action outside its envelope:

* The action is blocked
* The execution aborts immediately
* A notification explains what permission is missing

The user may:

* approve additional permissions (new permission envelope version)
* change intent
* disable the automation

---

## Interaction with Intent Spec

* Intent Spec describes meaning and expectations
* Permissions define what is allowed

Anything shown as **Enforced** in the UI must come from the permission system.

Best-effort constraints from the Intent Spec are displayed separately and labeled clearly.

---

## Repair constraints

* Repairs cannot request new permissions, Maintainer sessions get a copy of script's current permission envelope
* Repairs that require expanded authority must fail and escalate
* This keeps the authority envelope stable and not gameable by an unattended LLM

---

## Security and auditability

* All grants are versioned
* All approvals are logged
* Effective permissions are inspectable
* Runtime enforcement is centralized

This enables trust, debugging, and OSS review.

---

## Non-goals

This system does not attempt to:

* infer user intent perfectly
* auto-approve risky permissions
* hide authority changes
* make permissions invisible

Clarity is preferred over cleverness.

---

## Summary

Permissions are the **hard boundary** of Keep.AI.

LLMs may suggest.
Users approve.
The host enforces.

This separation is what makes delegation safe.
