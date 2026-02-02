# 15. Host Policies

This chapter defines configurable **host runtime policies** that govern retry behavior, backoff strategies, budget limits, and other operational parameters.

These policies are referenced by:

* Chapter 06 (Execution Model) — run lifecycle and replay behavior
* Chapter 09 (Failure Handling) — retry limits, repair budgets
* Chapter 13 (Reconciliation) — reconciliation backoff and attempt limits

---

## 15.1 Scope

Host policies govern:

* retry attempts and backoff intervals
* reconciliation attempt limits
* repair budgets (attempts, cost, time)
* timeout defaults
* rate limiting behavior

Host policies do **not** govern:

* intent or permission constraints (see Chapter 11)
* failure classification logic (see Chapter 09)
* mutation identity or ledger semantics (see Chapters 05, 13)

---

## 15.2 Retry and backoff

**Placeholder:**
Define retry policies including:

* maximum retry attempts (per failure class)
* backoff strategy (exponential, jitter)
* maximum backoff interval
* per-connector overrides

---

## 15.3 Reconciliation limits

**Placeholder:**
Define reconciliation policies including:

* maximum reconciliation attempts
* backoff intervals between attempts
* total time budget for reconciliation
* escalation trigger conditions

---

## 15.4 Repair budgets

**Placeholder:**
Define repair budget policies including:

* maximum consecutive repair attempts
* maximum cumulative repair cost
* maximum elapsed repair time
* per-automation overrides

---

## 15.5 Timeout defaults

**Placeholder:**
Define timeout policies including:

* default tool call timeout
* per-connector timeout overrides
* script execution timeout
* reconciliation call timeout

---

## 15.6 Configuration

**Placeholder:**
Define how policies are configured:

* system defaults
* per-workspace overrides
* per-automation overrides
* per-connector overrides

---

## 15.7 Summary

Host policies provide tunable operational parameters while keeping policy authority in the host runtime, not in LLMs or scripts.

All policy decisions are deterministic and auditable.
