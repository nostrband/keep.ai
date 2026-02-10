# Keep.AI

**Automation you delegate — not build.**

Most automation tools help you *create workflows*.
Keep.AI helps you *stop owning workflows*.

You describe what you want done in plain language.
Keep.AI creates the implementation, runs it locally, monitors failures, and repairs it when needed.

No visual graphs. No manual tweaking. No babysitting.

Keep.AI is backed by a detailed architecture: a split [runtime](docs/dev/04-runtime-planner-executor-maintainer.md) separating planning from execution, a [three-phase execution model](docs/dev/06-execution-model.md) with durable checkpoints, [mutation reconciliation](docs/dev/13-reconciliation.md) for uncertain side-effects, [host-enforced permissions](docs/dev/11-permissions.md), and [deterministic failure handling](docs/dev/09-failure-repair.md). See the full [design specs](docs/dev/).

Delegated automations must be boring.

---

## The problem with “AI-powered” automation

Modern automation tools haven’t really changed the core contract:

> If it breaks, the human fixes it.

Even with AI copilots, visual builders still assume:

* you design the workflow
* you understand its structure
* you debug it when it fails
* you remain the long-term maintainer

AI may help you build faster — but **ownership never moves**.

That makes true autopilot impossible.

---

## Delegation vs authorship

Keep.AI is built around a different contract.

### Authored automation (most tools)

* You build or edit a workflow
* The system executes *your artifact*
* Manual edits imply manual responsibility
* When it breaks, you are on call

### Delegated automation (Keep.AI)

* You describe intent, not structure — the system maintains a structured [Intent Spec](docs/dev/10-intent-spec.md) to prevent semantic drift
* The system generates the implementation via a sandboxed [Planner](docs/dev/04-runtime-planner-executor-maintainer.md#planner)
* Execution is [deterministic code](docs/dev/06-execution-model.md) — no LLM in the hot path
* The system owns [repair](docs/dev/09-failure-repair.md) — or fails closed and tells you

Once an automation is delegated, **the system is responsible for keeping it correct**.

You don’t tweak implementations.
You restate intent.

---

## Why there is no visual builder

Visual builders optimize for **creation**.
Keep.AI optimizes for **letting go**.

The moment you manually edit a workflow, an implicit contract is formed:

> the human is now the maintainer.

That contract makes system-owned maintenance unsafe.

So Keep.AI intentionally avoids editable workflow graphs as the primary interface.
This is not a missing feature — it’s what enables delegation.

---

## What “boring” actually means

“Boring” does not mean weak or simplistic.

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

## What Keep.AI is (and isn’t)

**Keep.AI is:**

* local-first — credentials stored locally, encrypted at rest ([connectors](docs/dev/08-connectors-auth.md))
* explicit about responsibility — [permissions are host-enforced](docs/dev/11-permissions.md), repairs cannot expand authority
* designed for recurring, long-running work — [durable execution](docs/dev/06-execution-model.md) with checkpoints, reconciliation, and crash recovery
* optimized for reliability over tweakability — users see [inputs and outputs](docs/dev/17-inputs-outputs.md), not workflow graphs

**Keep.AI is not:**

* a visual workflow editor
* a prompt playground
* a chatty AI assistant
* a replacement for bespoke engineered systems

If you want to hand-design and maintain workflows, you probably shouldn’t use Keep.AI — and that’s intentional.

---

## Why “Keep”

**Because it *keeps* your automations working.**

Keep.AI is named after the thing most automation tools avoid: **long-term responsibility**.

---

# FAQ

<details>
<summary>
Isn’t this just hiding complexity?
</summary>

No — it’s **relocating ownership**.

You can observe everything:

* runs
* logs
* failures
* decisions

What you’re not expected to do is manually repair broken glue code at 3am.

Visibility stays.
Maintenance responsibility moves.
</details>

<details>
<summary>
What happens when it breaks?
</summary>

If it breaks, that is explicitly the system's responsibility.

Failures are [classified by the host runtime](docs/dev/09-failure-repair.md), not by LLMs:

* **Transient** (network, rate limits) — automatic retry with backoff
* **Logic errors** — bounded [auto-repair](docs/dev/04-runtime-planner-executor-maintainer.md#maintainer) by the Maintainer
* **Auth/permission failures** — immediate pause, user action required
* **Indeterminate side-effects** — [reconciliation](docs/dev/13-reconciliation.md), or fail closed and escalate

If a safe repair is not possible, the automation fails closed and notifies you.

In most tools, a broken automation turns into a half-working graph you now own.
Keep.AI refuses to make that your problem.
</details>


<details>
<summary>
So I can’t tweak one small thing?
</summary>

You don’t tweak implementations.
You change intent.

Examples:

* “Also include X.”
* “Run this weekly instead.”
* “Ignore this edge case.”

This keeps the system fully responsible for correctness.

Manual tweaks would break that contract.
</details>

<details>
<summary>
Why not just generate a workflow and let me edit it?
</summary>

Because the moment you edit it, the system can no longer safely take responsibility for it.

Manual edits imply:

> “I understand this well enough to maintain it.”

Keep.AI is for cases where you *don’t want that burden*.
</details>

<details>
<summary>
Isn’t this just prompt engineering?
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

No — it’s for **delegators**, not authors.

Many technical users don’t want to own recurring glue work forever.
They want outcomes, accountability, and observability — not another system to maintain.
</details>

<details>
<summary>
What about complex or custom setups?
</summary>

Then delegation may not be the right model.

If you want to design a bespoke system and evolve it by hand, you should own it.
Keep.AI is for automations you want to **stop thinking about**.
</details>


<details>
<summary>
Isn’t this dangerous without human review?
</summary>

That’s why:

* execution is [sandboxed and phased](docs/dev/06-execution-model.md) — at most one mutation per run, tracked in a durable ledger
* permissions are [host-enforced](docs/dev/11-permissions.md) — LLMs cannot grant or expand them
* behavior is [fully observable](docs/dev/17-inputs-outputs.md) — users see what came in, what went out, and what's blocked
* failures [fail closed](docs/dev/09-failure-repair.md) — indeterminate side-effects are escalated, never retried blindly

Delegation without safety would be reckless.
Boring execution is the safety mechanism.
</details>

<details>
<summary>
How is this different from agents?
</summary>

Agents decide *what to do next* every time.

Keep.AI automations decide *how to do the same thing again*.

Planning can change.
Execution does not.

This is enforced architecturally. The [runtime](docs/dev/04-runtime-planner-executor-maintainer.md) has three explicit modes: Planner writes code, Executor runs code, Maintainer repairs code. The Executor [cannot call LLMs](docs/dev/06-execution-model.md), cannot modify code, and cannot change behavior across runs. Authority always remains in the host runtime.
</details>

---

## Philosophy (tl;dr)

Most tools optimize for building automations.
Keep.AI optimizes for letting go.

If that sounds uncomfortable, this product may not be for you — and that’s okay.

---

