# Failure Handling and Repair

This document describes how Keep.AI detects failures, classifies them, attempts repair, and escalates to human action — without violating the delegation contract.

Failure handling is a **first-class system concern**, not an afterthought.

This chapter applies to the execution model defined in Chapter 06. Failures occur within **consumer runs** processing **events**. Escalation pauses the run and may affect reserved events. See Chapter 06 for run lifecycle and Chapter 13 for mutation-specific failure handling.

---

## Core principle

> **Failures are classified and routed by the host runtime, not by LLMs.**

LLMs may assist with:

* proposing bounded repairs
* explaining failures to humans

LLMs may not:

* decide failure classes
* decide recovery strategies
* decide whether escalation is required

Authority always remains in deterministic host logic.

---

## Failure lifecycle (high level)

1. Execution fails or produces an invalid outcome
2. Host runtime captures evidence
3. Host runtime classifies the failure
4. Host runtime selects a handling path:
   * retry
   * repair
   * escalate
5. LLM-driven repair is invoked *only if permitted*
6. Automation resumes or remains paused

Each step is explicit, logged, and auditable.

---

## Failure detection

Failures may be detected at multiple layers:

* script runtime errors (exceptions, timeouts)
* tool call failures (HTTP errors, invalid responses)
* constraint violations (script-level assertions)
* precondition failures (external assumptions not met)
* permission or authentication failures
* runtime safety failures (infinite loop, tool call storm, sandbox limits)
* indeterminate outcomes from side-effecting operations

Detection produces a **failure record** containing:

* raw failure signal
* location (script step / tool)
* tool call logs
* output / error data
* execution context (run ID, workflow ID)

**Placeholder:**
Describe failure record schema and capture points.

---

## Failure taxonomy

All failures are mapped to a **closed set of classes** by the host runtime.

---

### 1) Transient failures

Examples:

* network timeouts
* temporary API unavailability
* rate limiting

Properties:

* expected to resolve without code changes
* safe to retry

Handling:

* retry with backoff
* capped attempts
* no LLM involvement

---

### 2) Logic failures (repair-eligible)

Examples:

* incorrect handling of tool input/output
* constraint violations (script-level assertions such as caps or invariants)
* unclassified script exceptions
* runtime safety failures (infinite loop, tool call storm, etc.)

Properties:

* implementation is incorrect relative to intent or runtime
* intent itself is still assumed valid
* repair is assumed possible *in principle*

Handling:

* eligible for bounded repair
* forwarded to Maintainer after host-side gating
* repeated repair failure invalidates the above assumptions and forces escalation to re-plan

---

### 3) Permission / authentication failures

Examples:

* expired OAuth tokens
* revoked access
* missing scopes
* disallowed actions under configured constraints

Properties:

* cannot be resolved autonomously
* require explicit human action

Handling:

* immediate escalation
* automation paused
* no repair attempts
* execution resumes only after human action

> We use “permissions” broadly to mean **what actions are allowed under what constraints**.
> We intentionally do not distinguish between “permissions” and “policy”.

---

### 4) Precondition failures (external assumptions)

Examples:

* referenced table does not exist
* required folder, label, or channel is missing
* external resource was deleted or renamed

Properties:

* failure is caused by external world state
* correctness cannot be restored without human confirmation or intent change

Handling:

* immediate escalation
* no repair attempts
* user may fix environment or modify intent to allow creation or substitution

Preconditions are explicitly surfaced to users with clear messages, they are created by Planner and are basically an optimization to avoid logic error -> repair failed -> escalate loop.

---

### 5) Indeterminate side-effect outcomes

Examples:

* write operation timed out after request was sent
* crash or restart during non-idempotent mutation
* external API provides no reliable reconciliation mechanism

Properties:

* system cannot determine whether a side effect occurred
* retrying may duplicate or corrupt state
* correctness cannot be established deterministically

Handling:

* host runtime attempts **automatic reconciliation**
* if reconciliation is impossible:

  * fail closed
  * escalate with a clear explanation

These failures are never routed to the Maintainer for repair. User is expected to manually verify the state of the external system and re-activate or re-plan the automation.

---

**Placeholder:**
Define exact enum values and mapping rules.

---

## Retry handling (transient failures)

Retry behavior is **pure host policy**.

The runtime enforces:

* retry eligibility by failure class
* backoff strategy
* maximum attempts
* idempotency guarantees

Retries do not:

* invoke LLMs
* modify implementations
* change intent

If retries are exhausted, the failure is reclassified and re-routed.

See Chapter 15 for retry and backoff policy configuration.

---

## Reconciliation of side effects

All mutating tool calls are executed through host-managed mutation primitives.

For each mutation, the host runtime:

* records mutation start in durable storage
* attempts the external operation
* records success if confirmed
* attempts reconciliation on crash, timeout, or restart

Reconciliation is:

* deterministic
* tool-specific
* fully host-managed

Planner-generated scripts do **not** encode reconciliation logic.

If reconciliation cannot deterministically establish outcome, the mutation is marked indeterminate and escalated.

See Chapter 13 for mutation ledger and reconciliation workflow.

---

## Repair eligibility

Only failures classified as **logic failures** may be considered for repair.

Before invoking the Maintainer, the host runtime verifies:

* failure ∈ repair-eligible logic class
* intent constraints are satisfiable
* permissions allow required operations
* no indeterminate side-effect state exists
* repair budgets (attempts, cost, time) remain (see Chapter 15)

If any check fails, repair is forbidden and escalation is required.

---

## Repair process (Maintainer involvement)

When repair is permitted, the host runtime invokes the Maintainer with:

* current intent
* failed implementation
* failure evidence
* allowed permissions
* prior repair attempts (if any)

The Maintainer should propose:

* a modified script that satisfies the same intent and is backward compatible

The proposal is treated as **untrusted input**, and is validated before deployment.

The Maintainer does not decide control flow or escalation.

---

## Repair validation

All repair proposals are validated before deployment.

Repair proposals are validated under stricter constraints than planner output, including backward-compatibility and non-expansion of side effects.

Only validated repairs are versioned and executed.

Rejected repairs count toward repair attempt limits.

**Placeholder:**
Describe validation pipeline and replay harness.

---

## Repair limits and termination

Autonomous repair is explicitly bounded (see Chapter 15 for policy configuration).

The host runtime enforces:

* maximum consecutive repair attempts
* maximum total repair cost
* maximum elapsed repair time

When limits are exceeded:

* repair is permanently disabled for the failure
* escalation becomes mandatory

This prevents repair loops and runaway behavior.

---

## Escalation to human action

Escalation is a **deterministic outcome**, not a suggestion.

When escalation is required, the runtime:

* pauses the automation
* records failure state and evidence
* emits a structured “action needed” event

At this point, an LLM may be used **only** to:

* explain why execution cannot proceed
* summarize violated constraints or unmet preconditions
* suggest possible intent changes or user actions

LLM output does not resume execution.

Only explicit human action can unblock the automation.

**Placeholder:**
Map escalation events to UX and resume mechanics. See Chapter 07 for run-level actions (Try again, It didn't happen, Skip).

---

## Post-escalation outcomes

After human action, one of the following occurs:

* intent is modified → Planner runs
* permissions or environment are updated → Executor resumes
* automation is disabled → terminal state
* no action taken → remains paused

All outcomes are logged.

---

## Auditability and observability

Every failure and recovery attempt is recorded:

* original failure evidence
* classification result
* retries and backoff
* repair attempts and outcomes
* reconciliation attempts
* escalation rationale

This ensures:

* reproducibility
* trust
* debuggability without manual maintenance

**Placeholder:**
Link to run logs, events, and audit records.

---

## Anti-patterns (explicitly rejected)

The following behaviors are not allowed:

* LLM-based failure classification
* LLM deciding whether to escalate
* silent retries without limits
* continuing execution after indeterminate side effects
* repairing by weakening constraints or bypassing reconciliation

These patterns break delegation and trust.

---

## Summary

Failures in Keep.AI are not surprises — they are controlled states.

The host runtime:

* detects
* classifies
* reconciles
* repairs (when allowed)
* escalates deterministically

LLMs assist only where explicitly permitted.

By making failure handling explicit, bounded, and auditable, Keep.AI enables automations that can be safely delegated — and safely forgotten.

