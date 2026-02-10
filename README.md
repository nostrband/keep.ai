# Keep.AI

**Workflow automation engine with AI to write and fix the code.**

You describe what you want done in plain language.
Keep.AI generates the code, runs it in a sandbox, monitors it, and auto-repairs it when it breaks.

No visual graphs. No manual tweaking. No babysitting.

Keep.AI is backed by a detailed architecture: a split [runtime](docs/dev/04-runtime-planner-executor-maintainer.md) separating planning from execution, a [three-phase execution model](docs/dev/06-execution-model.md) with durable checkpoints, [mutation reconciliation](docs/dev/13-reconciliation.md) for uncertain side-effects, [host-enforced permissions](docs/dev/11-permissions.md), and [deterministic failure handling](docs/dev/09-failure-repair.md). See the full [design specs](docs/dev/).

The specs make for dry reading. So do the automations. That's by design — reliable automation must be boring.

---

## The problem with automation today

Two approaches dominate. Both require you to maintain the system long-term.

### Workflow builders (n8n, Zapier, Make)

With automation builders:

* you design the workflow
* you understand its structure
* you debug it when it fails
* you remain the long-term maintainer

AI copilots may speed up creation — but you still have to **verify the implementation**.

### Agentic automation (Claude Code, OpenClaw, coding agents)

AI coding agents can automate in two ways:

**Run the LLM on every execution.** Drift, hallucinations, cost, weak safety boundaries. The same automation may behave differently each run.

**Have the LLM write scripts and run them on schedule.** This solves drift and cost — but you're back to maintaining the code. When a script crashes mid-mutation, did the side-effect commit? When an API changes shape, who updates the script? When auth expires at 3am, what pauses and what keeps running?

You could ask AI to handle all of that — failure recovery, mutation tracking, crash reconciliation, permission enforcement. But at that point you're not building an automation. You're building an automation engine from scratch — and you're its maintainer.

The hard part isn't generating the script. It's everything that happens after.

> In both cases, you remain the maintainer — of the workflow graph, the scripts, or the engine you built around them.

---

## Structured code, AI-maintained

Keep.AI is a workflow engine where AI generates, monitors, and repairs the code. You get deterministic execution, durable checkpoints, and sandboxed runs — without having to write or maintain the implementations.

### Workflow builders and agents

* Builders: you design and maintain workflow graphs
* Agents (agentic loop): you hope the LLM does the right thing each time
* Agents (scripted): you maintain the code — and everything underneath it
* In all cases: when it breaks, you fix it

### Keep.AI

* You describe what you want — the system maintains a structured [Intent Spec](docs/dev/10-intent-spec.md) to prevent semantic drift across auto-repairs
* AI generates the implementation in a sandboxed [Planner](docs/dev/04-runtime-planner-executor-maintainer.md#planner)
* Execution is [deterministic code](docs/dev/06-execution-model.md) — no LLM in the hot path
* When it breaks, the system [auto-repairs](docs/dev/09-failure-repair.md) — or stops and tells you what went wrong

You change what you want done, not how it's implemented. The system regenerates the code from the updated intent.

---

## Why there is no visual builder

If you can manually edit a workflow, auto-repair becomes unsafe — the system can't distinguish your intentional changes from things it should fix.

Keep.AI avoids editable workflow graphs so that auto-repair remains safe. The system can freely regenerate and fix implementations because it knows the human hasn't manually modified them.

This is a tradeoff: less manual control, but the system can maintain the code autonomously.

---

## What "boring" actually means

"Boring" does not mean weak or simplistic.

It means:

* deterministic execution
* no creative interpretation during runs
* no silent behavior changes
* no agentic improvisation in production paths

LLMs are used to **plan and repair**, not to repeatedly decide what to do next.

The runtime enforces this structurally. The [Planner](docs/dev/04-runtime-planner-executor-maintainer.md#planner) generates implementations. The [Executor](docs/dev/04-runtime-planner-executor-maintainer.md#executor) runs them as sandboxed scripts with no LLM access. The [Maintainer](docs/dev/04-runtime-planner-executor-maintainer.md#maintainer) proposes bounded repairs only when the host runtime permits it. All LLM-generated code is treated as untrusted input and [validated before execution](docs/dev/04-runtime-planner-executor-maintainer.md#validation-and-deployment).

> Planning can be flexible.
> Execution must be boring.

---

## What Keep.AI is (and isn't)

**Keep.AI is:**

* local-first — credentials stored locally, encrypted at rest ([connectors](docs/dev/08-connectors-auth.md))
* permission-enforced — [host runtime checks every operation](docs/dev/11-permissions.md), auto-repairs cannot expand the permission envelope
* built for recurring, long-running work — [durable execution](docs/dev/06-execution-model.md) with checkpoints, reconciliation, and crash recovery
* observable without requiring maintenance — users see [inputs and outputs](docs/dev/17-inputs-outputs.md), not workflow graphs

**Keep.AI is not:**

* a visual workflow editor
* a prompt playground
* a chatty AI assistant
* a replacement for bespoke engineered systems

If you need fine-grained control over workflow structure, Keep.AI is the wrong tool. It trades manual control for autonomous maintenance.

---

## Why "Keep"

Because it *keeps* your automations working — auto-repair, crash recovery, failure classification, and reconciliation are built into the [execution model](docs/dev/06-execution-model.md).

---

# FAQ

<details>
<summary>
Isn't this just hiding complexity?
</summary>

No. Everything is observable — runs, logs, failures, decisions, costs.

What's different is that when something breaks, the system attempts auto-repair instead of handing you a broken workflow to debug. You can see exactly what happened and why, but you're not expected to fix the glue code yourself.
</details>

<details>
<summary>
What happens when it breaks?
</summary>

Failures are [classified by the host runtime](docs/dev/09-failure-repair.md), not by LLMs:

* **Transient** (network, rate limits) — automatic retry with backoff
* **Logic errors** — bounded [auto-repair](docs/dev/04-runtime-planner-executor-maintainer.md#maintainer) by the Maintainer
* **Auth/permission failures** — immediate pause, user action required
* **Indeterminate side-effects** — [reconciliation](docs/dev/13-reconciliation.md), or fail closed and escalate

If auto-repair fails, the automation stops and notifies you with the failure context. It does not silently degrade into a half-working state.
</details>


<details>
<summary>
So I can't tweak one small thing?
</summary>

You change what the automation does, not how it's implemented:

* "Also include X."
* "Run this weekly instead."
* "Ignore this edge case."

The system regenerates the implementation from the updated [Intent Spec](docs/dev/10-intent-spec.md). Direct code edits are not exposed because they would make auto-repair unsafe — the system couldn't tell your changes from bugs.
</details>

<details>
<summary>
Why not just generate a workflow and let me edit it?
</summary>

Because auto-repair requires the system to know that the current implementation matches the intent. If you've manually edited the code, the system can't safely regenerate or patch it without risking overwriting your changes.

This is a deliberate tradeoff: no manual editing, but the system can autonomously fix and evolve the implementation.
</details>

<details>
<summary>
Isn't this just prompt engineering?
</summary>

No.

LLMs are used to:

* generate implementations
* repair implementations

They are **not** used to run automations repeatedly.

Execution is [deterministic, sandboxed code](docs/dev/06-execution-model.md) structured as producers and consumers with a [three-phase model](docs/dev/06b-consumer-lifecycle.md) (prepare → mutate → next). Each phase has durable checkpoints. Mutations are tracked in a [ledger](docs/dev/13-reconciliation.md). LLMs are not in the hot path.
</details>

<details>
<summary>
Is this only for non-technical users?
</summary>

No. Technical users who don't want to maintain recurring glue code are the primary audience. You get structured execution, auto-repair, and full observability — without building and maintaining the automation infrastructure yourself.
</details>

<details>
<summary>
What about complex or custom setups?
</summary>

If you need fine-grained control over execution flow, custom error handling, or bespoke integrations — build it yourself. Keep.AI is for recurring automations where the implementation details don't matter to you, only the outcome.
</details>


<details>
<summary>
Isn't this dangerous without human review?
</summary>

Safety comes from the execution model, not from human review of every run:

* execution is [sandboxed and phased](docs/dev/06-execution-model.md) — at most one mutation per run, tracked in a durable ledger
* permissions are [host-enforced](docs/dev/11-permissions.md) — LLMs cannot grant or expand them
* behavior is [fully observable](docs/dev/17-inputs-outputs.md) — users see what came in, what went out, and what's blocked
* failures [fail closed](docs/dev/09-failure-repair.md) — indeterminate side-effects are escalated, never retried blindly
</details>

<details>
<summary>
How is this different from agents?
</summary>

Agents decide *what to do next* on every run — each execution is a fresh LLM call.

Keep.AI runs fixed, pre-generated code. The LLM is only involved when generating or repairing that code, not during execution.

This is enforced architecturally. The [runtime](docs/dev/04-runtime-planner-executor-maintainer.md) has three explicit modes: Planner writes code, Executor runs code, Maintainer repairs code. The Executor [cannot call LLMs](docs/dev/06-execution-model.md), cannot modify code, and cannot change behavior across runs. Authority always remains in the host runtime.
</details>

---

## tl;dr

Keep.AI generates automation code from your description, runs it deterministically, and auto-repairs it when it breaks. You describe what you want. The system handles how — and keeps handling it.

---
