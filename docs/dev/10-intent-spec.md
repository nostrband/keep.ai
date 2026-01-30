# Intent Spec (Drift Control & Semantic Contract)

The **Intent Spec** is a system-maintained, human-readable description of *what an automation is meant to do*.

It exists to prevent **semantic drift** when implementations are generated and repaired by LLMs, and to make **implicit defaults explicit** for users.

It is **not** a security boundary, **not** an enforcement mechanism, and **not** an implementation.

---

## Why the Intent Spec exists

Keep.AI is built around **delegation, not authorship**.

Users do not maintain workflow code.
The system generates and repairs implementations autonomously.

This introduces a hard requirement:

> The system must be able to verify that new or repaired code still matches the *original intent*, without relying on human memory or fragile prompts.

Plain natural-language prompts are insufficient:

* they are ambiguous
* they evolve implicitly
* they don’t expose defaults
* they drift over time

The Intent Spec exists to:

* anchor meaning across generations and repairs
* prevent gradual behavioral drift
* make assumptions and defaults visible
* give both humans and LLMs a stable reference point

Without it, “self-healing” degrades into “self-mutation”.

---

## What the Intent Spec is (and is not)

### The Intent Spec **is**

* system-owned
* human-readable
* stable across script auto-repairs
* used by LLMs to review and validate changes
* visible to users as a summary of “what this automation means”

### The Intent Spec **is not**

* an implementation
* a workflow graph
* a permissions model
* a rate-limit or budget definition
* a guarantee of enforcement

It describes **meaning**, not **mechanics**.

---

## Primary responsibilities

The Intent Spec answers one question only:

> *“What is this automation supposed to do, and what assumptions were made?”*

Specifically, it captures:

1. **Goal**

   * the intended outcome in plain language

2. **Inputs and outputs**

   * what information is consumed
   * what effects are expected

3. **Assumptions and defaults**

   * choices made by the system when the user did not specify details

4. **Non-goals**

   * things the automation is explicitly not meant to do

5. **Semantic constraints**

   * behavioral rules expressed in human language

These are used to evaluate whether a generated or repaired implementation is *still the same automation*.

---

## Structure (conceptual)

> Exact formatting is intentionally flexible; stability and readability matter more than schema rigidity.

A typical Intent Spec contains:

### Goal

> “Summarize new invoices from Gmail and post a daily summary to Slack.”

### Inputs

* Emails labeled “Invoices”
* New messages since last run

### Outputs

* One Slack message per day
* No direct replies or outbound emails

### Assumptions / defaults

* Ignore promotional emails
* Use message body text only
* Post summaries during business hours

### Non-goals

* No file downloads
* No external notifications

### Semantic constraints (best-effort)

* “Do not contact external recipients”
* “Do not modify email state”
* “Avoid duplicate summaries”

All of the above are **semantic**, not authoritative enforcement.

---

## Enforced vs best-effort constraints

To avoid false guarantees, Keep.AI explicitly separates **enforced** behavior from **best-effort** behavior.

### Enforced (authoritative)

* Permissions, grants, budgets, and limits enforced by the host runtime
* Rendered directly from system state
* Guaranteed regardless of LLM behavior

These are documented elsewhere:

* permissions & grants → `11-permissions.md`
* budgets & limits → corresponding policy docs
* sandbox limits → runtime docs

### Best-effort (probabilistic)

* Semantic constraints expressed in the Intent Spec
* Used by planner, repair, and auditor LLMs
* Clearly labeled as *not enforced by the host*

Best-effort constraints exist because:

* not all semantics are enforceable mechanically
* they still materially reduce drift
* they make expectations explicit to users

The UI must clearly distinguish these two categories.

> Anything displayed as **Enforced** must be derived from host-enforced policy — never from LLM-authored text.

---

## Relationship to permissions and policy

The Intent Spec does **not** define permissions or limits.

Instead:

* the planner may *propose* required permissions or limits
* the host validates and normalizes them
* the user explicitly approves them
* the runtime enforces them

Approved permissions and limits are then **displayed alongside** the Intent Spec, but remain a separate artifact.

Editing permissions or limits is governance, not authorship.

---

## Intent Spec and repairs

When a failure occurs, the maintainer agent must:

1. Load the current Intent Spec
2. Analyze failure context and run logs
3. Propose a repair
4. Verify that the repair still satisfies the Intent Spec
5. Verify that it stays within enforced policy
6. Deploy only if both checks pass

Important constraints:

* Repairs **cannot** expand permissions or limits
* Repairs may fail if additional permissions are required
* Such failures are escalated to the user as action-needed

This preserves envelope stability while allowing autonomous fixes.

---

## Defense in depth for best-effort constraints

Because best-effort constraints are probabilistic, Keep.AI applies multiple layers of review:

* **Creator LLM** generates or repairs code
* **Reviewer/Auditor LLM** evaluates it against the Intent Spec
* Optional periodic audits may review run logs for drift

These steps reduce risk, but do not replace enforcement.

> Enforcement lives in the host.
> Review lives in the Intent Spec.

---

## How the Intent Spec evolves

The Intent Spec is versioned, and only modified when user engages with the Planner agent. 

Repairs do **not** mutate intent.

This ensures that:

* historical runs remain interpretable
* responsibility boundaries stay clear
* “it did the wrong thing” can be reasoned about precisely

---

## Why users do not edit the Intent Spec directly

Direct editing would:

* reintroduce authorship
* require users to reason about formal specs
* make responsibility ambiguous

Instead:

* users change intent in natural language
* the system updates the Intent Spec deterministically
* changes are reviewed and displayed explicitly

Delegation requires a single owner of correctness.

---

## Common failure modes this design avoids

* Prompt drift across repairs
* Silent expansion of behavior
* Implicit defaults becoming invisible
* Confusing “is this enforced?” assumptions
* LLMs redefining automation meaning over time

---

## Summary

The Intent Spec is the **semantic contract** of a delegated automation.

It exists because:

* implementations are disposable
* LLMs are fallible
* users need clarity without authorship

It defines *what we mean* —
not *what we allow* and not *what we enforce*.

Those boundaries live elsewhere.

