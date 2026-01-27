# Philosophy: Delegation over Authorship

Keep.AI is built around a single, opinionated idea:

> **Automation should be delegated, not authored.**

Most automation tools help users *build workflows*.
Keep.AI helps users *stop owning workflows*.

This document explains what that means, why we believe it is necessary for reliable automation, and how it shapes every major design decision in the system.

---

## The problem we are trying to solve

Automation tools today — even “AI-powered” ones — still operate under the same core contract:

> If the automation breaks, the human is responsible for fixing it.

Visual builders, low-code tools, and AI copilots all reinforce this model:

* the human designs or edits the workflow
* the workflow is treated as a human-authored artifact
* when something breaks, the system hands it back to the human

AI may speed up creation, but **ownership never moves**.

This model works when:

* workflows are short-lived
* failures are rare
* humans are willing to stay mentally attached to the automation

It breaks down for long-running, recurring, “background” work — exactly the kind of work automation is supposed to remove from human attention.

---

## Delegation vs authorship

Keep.AI intentionally changes the ownership contract.

### Authored automation (most tools)

* The human builds or edits a workflow
* The system executes *that artifact*
* Manual edits imply human responsibility
* When it breaks, the human is the maintainer

Even if AI generates the workflow, the moment a human:

* sees it
* tweaks it
* reasons about its structure

…the system can no longer safely claim responsibility for its correctness.

### Delegated automation (Keep.AI)

* The human describes **intent**, not structure
* The system generates the implementation
* The system executes and monitors it
* The system repairs it — or fails closed and notifies the human

In this model:

* humans restate intent
* the system owns implementation details
* responsibility does not silently shift back to the user

This contract is stricter, but it is the only one that enables true autopilot.

---

## Why this requires saying “no” to visual builders

Visual builders are not bad tools.
They are optimized for a different goal: **creation**.

Keep.AI is optimized for **letting go**.

The moment a system exposes an editable workflow graph as the primary interface, it creates an implicit contract:

> “You understand this well enough to maintain it.”

That contract makes system-owned maintenance unsafe.

For this reason, Keep.AI intentionally avoids:

* editable workflow graphs
* manual step-by-step tuning
* exposing implementation details as a control surface

This is not a missing feature.
It is a prerequisite for delegation.

---

## What “boring” means in Keep.AI

We often describe Keep.AI automations as *boring*.
This is a design goal, not an apology.

**Boring execution means:**

* deterministic behavior
* no creative interpretation during runs
* no silent behavior changes
* no agentic improvisation in production paths

LLMs are allowed to:

* plan automations
* generate or repair implementations

LLMs are **not** allowed to:

* repeatedly decide what to do during execution
* introduce unnecessary nondeterminism into recurring runs

> Planning can be flexible.
> Execution must be boring.

**Placeholder:**
Describe how this is enforced in the runtime (e.g. separation of planner vs executor, tool availability, sandbox capabilities).

---

## Ownership boundaries (who is responsible for what)

A delegated system only works if responsibility boundaries are explicit.

### The system owns:

* implementation details
* execution correctness
* retries and backoff
* safe repair attempts
* detecting when human input is required

### The human owns:

* defining intent
* granting permissions
* resolving external blockers (e.g. authentication)
* deciding whether to continue or disable an automation

When the system cannot proceed safely, it must:

* stop
* explain why
* ask for a specific action

It must **not** silently degrade into partial or unpredictable behavior.

**Placeholder:**
Document the exact “action-needed” states and how they are represented internally (tables, events, UI surfaces).

---

## Observability without maintainership

Delegation does not mean opacity.

Keep.AI is designed to provide:

* full run history
* logs and events
* clear failure explanations
* cost and resource usage visibility

What it does *not* require:

* manual debugging
* spelunking through workflow graphs
* editing broken glue code under time pressure

> You can observe everything.
> You are not expected to maintain it.

**Placeholder:**
Link to observability primitives: run records, tool call logs, cost accounting.

---

## Failure is a first-class state

In Keep.AI, failure is not an exception — it is an explicit system state.

Failures are classified into categories such as:

* transient (retryable)
* logic or assumption errors (repairable)
* permission or authentication errors (human action required)
* unsafe or ambiguous failures (fail closed)

Each category has a defined handling strategy.

The system must never “guess” its way forward when correctness is uncertain.

**Placeholder:**
Describe failure classification logic and routing (retry vs repair vs pause+escalate).

---

## Tradeoffs we intentionally accept

Keep.AI deliberately trades off some things in order to make delegation possible.

We accept:

* less manual control
* fewer tweakable knobs
* a more opinionated UX
* saying “this is not a good fit” for some use cases

In exchange, we aim to provide:

* long-term reliability
* reduced cognitive load
* clear accountability
* automations that can be safely forgotten

If you want to design and maintain bespoke workflows by hand, Keep.AI is probably not the right tool — and that is by design.

---

## Implications for contributors

This philosophy is not just conceptual; it is enforceable.

When contributing to Keep.AI, changes should be evaluated against questions like:

* Does this increase or reduce user authorship?
* Does this preserve system responsibility for correctness?
* Does this introduce nondeterminism into execution?
* Does this blur the boundary between planning and execution?

Features that violate these principles — even if useful in isolation — may be rejected to preserve the integrity of the system.

---

## Summary

Most automation tools optimize for building workflows.

Keep.AI optimizes for **letting go of them**.

It's *Keep* because you delegate to it, and it *keeps* your automations going.

Delegation requires:

* strong boundaries
* boring execution
* explicit responsibility
* and the willingness to say no to familiar patterns

This document defines those boundaries.
The rest of the system exists to enforce them.

