## 1) Product philosophy and non-negotiables

**Cover**

* Delegation vs authorship (core contract)
* “Boring execution” definition
* What the system *owns* vs what the user owns
* Explicit tradeoffs (what we refuse to build and why)
* Design principles (“no manual workflow editing”, “observability without maintainer burden”, etc.)

**Expand (based on your input)**

* Contrast with visual builders: builder mindset creates attachment → kills autopilot
* Separation: LLMs for plan/repair, deterministic scripts for execution
* “Action-needed” as the only “human-in-the-loop” path (auth, permissions, approvals)

**Rationale (why this doc matters)**

* OSS contributors will otherwise reintroduce “builder” features (graph editor, manual step tweaking) that break the category.
* These principles are your architectural guardrails and PR review rubric.

---

## 2) Core mental model and user experience surfaces

**Cover**

* UX surfaces: chats, notifications/action-needed inbox, automation list, run history, cost view
* How users create/modify automations (intent changes, not code edits)
* Failure UX: retry vs auto-fix vs pause+escalate
* “Control-only” clients (web/mobile planned) and what they can/can’t do
* Expectations for “manager mode” vs “engineer mode” (without framing it as roles)

**Expand**

* Notifications: “action-needed section for human-action-needed errors like auth issues etc.”
* Visibility + cost tracking into workflows/runs (first-class UX, not hidden logs)

**Rationale**

* UX is part of the contract: if you expose “edit workflow”, you’ve reintroduced authorship.
* Clear UX states reduce support burden and make the system feel reliable.

---

## 3) Data model and persistence (SQLite-first)

**Cover**

* Database as source of truth: threads/messages, chats/chat_events, tasks/task_runs, workflows/scripts/script_runs, inbox
* Why split “internal agent thread” vs “user-facing chat thread”
* Event sourcing approach (chat_events / run logs)
* Schema evolution/migrations and compatibility guarantees

**Expand**

* You already have: sqlite DB + API, threads/messages, chats/chat_events, tasks/task_runs, workflows/scripts/script_runs, inbox, scheduler/worker model.

**Rationale**

* Contributors need to understand which tables are “product UX” vs “execution plumbing”.
* Strong persistence design is required for replayability, debugging, and OSS trust.

---

## 4) Runtime model: planner vs executor vs maintainer

**Cover**

* The three modes:

  * **Planner (agentic)**: explores tools + writes scripts
  * **Executor (boring)**: runs deterministic script
  * **Maintainer (repair)**: triages failures, repairs scripts, resumes
* “No LLM in hot path” policy
* When repair is triggered and when it is forbidden
* Safety gates and “fail closed” semantics

**Expand**

* “js sandbox for agent to research/build/debug the scripts (‘eval’ as main agentic tool)”
* “agent has the same tools — js sandbox — in which scripts will later run”
* “script error classification: retry/backoff vs forward to agent fix vs pause+escalate”

**Rationale**

* This is the single most important architecture concept for your category.
* Contributors will otherwise mix concerns (LLM calls inside production scripts, etc.).

---

## 5) Script execution environment (QuickJS sandbox)

**Cover**

* Why QuickJS (security + determinism + portability)
* Host<->sandbox boundary design
* Standard library available inside scripts (what’s allowed)
* Limits: CPU, wall time, memory, IO quotas
* Deterministic time/randomness strategy
* Logging/trace in the sandbox

**Expand**

* “quickjs runtime to safely run the scripts”

**Rationale**

* Sandbox is the trust boundary; OSS users will evaluate you on it.
* Determinism requires controlling time, randomness, retries, and side effects.

---

## 6) Tooling API inside the sandbox (capabilities)

**Cover**

* Tool taxonomy:

  * Connectors (Gmail, etc.)
  * Web search/fetch
  * Files/notes
  * Image generation/transform
  * LLM-only tools (extract/summarize/judge/etc.)
* Typed interfaces + versioning
* Idempotency and dedupe patterns for side-effect tools
* Tool call tracing, redaction, and cost accounting hooks

**Expand**

* “oauth connectors for integrations”
* “visibility + cost tracking into workflows/runs”
* “js sandbox … scripts will later run”

**Rationale**

* Tools define what automations can do; stable tool contracts make repairs reliable.
* Idempotency is mandatory to avoid duplicate sends/posts during retries/repairs.

---

## 7) Connectors and authentication model (OAuth + beyond)

**Cover**

* Connector lifecycle: connect/check/revoke
* Credential storage model (local encryption, rotation, scopes)
* Connector client instantiation and injection into tools
* Error taxonomy for auth failures (token expired, revoked, missing scopes)
* Testing connectors (mock vs live)
* Adding a new connector (step-by-step contributor guide)

**Expand**

* Your Gmail connector pattern: connect button (OAuth), check button, config saved, client passed to agent tools.

**Rationale**

* Connectors are the ecosystem. OSS needs a clear “how to add integrations” path.
* Auth issues are the #1 source of “action needed” and must be productized.

---

## 8) Scheduling, event routing, and execution lifecycle

**Cover**

* Scheduler design (cron + event-driven triggers)
* Inbox routing semantics (source/target type/id)
* Worker orchestration (task scheduler → worker → run)
* Concurrency model and locking (per task/workflow)
* Backpressure and rate limiting

**Expand**

* “task scheduler detects new inbox items and launches workers”
* “inbox table delivers internal events to tasks/workflows”
* “workflow worker / task worker”

**Rationale**

* Reliability depends on correct routing and concurrency.
* Contributors will add triggers and need to not break ordering guarantees.

---

## 9) Failure handling and repair system

**Cover**

* Error classification pipeline (where classification happens, with what evidence)
* Classes: transient (retry), logic (repair), auth/permission (action-needed), unknown (safe default)
* Repair loop design:

  * gather context
  * propose patch
  * test patch (sandbox replay)
  * deploy patch
  * resume
* Repair storm prevention (budgets, caps, cooldowns)
* Audit trail (what changed and why)

**Expand**

* “retry with backoff (network etc) or forward to agent for a fix (logic etc) or pause+escalate (auth etc).”

**Rationale**

* This is where your “delegation” promise is proven or destroyed.
* OSS users care about “does it spam my email when it retries?”

---

## 10) Intent contract and invariants (system-owned spec)

**Cover**

* What “intent” means beyond a text prompt
* Intent Contract schema (structured constraints + invariants)
* How it’s created (from user input + confirmations)
* How it evolves safely (versioning, diffs)
* How repair is validated against it
* Examples of common invariants (“never email outside domain”, “max N actions/day”)

**Rationale**

* Prevents drift over time.
* Gives contributors a clear anchor for safety and correctness decisions.

---

## 11) Permissions model (now + future “per resource”)

**Cover**

* Current model (capability-based toggles)
* Planned: per-resource/per-workflow permissions
* Enforcement points:

  * production runner
  * build/repair sandbox
  * UI surfaces (what user sees/approves)
* Permission escalation UX (“request additional scope”)
* Threat model alignment

**Expand**

* “planning detailed per-resource per-workflow permissions later.”

**Rationale**

* Delegation requires trust; trust requires explicit boundaries.
* OSS contributors must understand where to add enforcement, not just UI.

---

## 12) Observability, auditability, and cost tracking

**Cover**

* What gets logged: tool calls, outputs (redacted), timing, costs
* Run timeline UI data model (events vs logs)
* Cost accounting per:

  * workflow
  * run
  * tool
  * connector
* Redaction and privacy design
* Exportability (for OSS trust)

**Expand**

* “visibility + cost tracking into workflows/runs”

**Rationale**

* Observability is how you replace manual editing with confidence.
* Cost tracking prevents “repair storms” and makes automation sustainable.

---

## 13) Security model and threat analysis

**Cover**

* Threat model: exfiltration, malicious scripts, supply chain, connector abuse
* Isolation layers: QuickJS, tool permissioning, credential vault
* E2EE control channel design (control-only client)
* Update signing / release integrity (OSS distribution)
* Responsible disclosure policy

**Expand**

* “e2ee-connectable web (mobile planned) control-only version”

**Rationale**

* You are an automation tool: users will assume worst-case risks.
* A clear security doc is table stakes for OSS adoption.

---

## 14) Packaging, deployment modes, and updates

**Cover**

* Desktop tray app architecture (Electron + local node server)
* Dockerized server+client mode
* Networking model (local ports, remote control)
* Update mechanisms (auto-update vs manual)
* Backwards compatibility guarantees for DB + scripts

**Expand**

* “local-first (desktop app sits in tray) or dockerized server+client app…”

**Rationale**

* Contributors need to know “where code runs” and “what’s supported”.
* OSS installs fail without good deployment docs.

---

## 15) Testing strategy and quality bar

**Cover**

* Unit tests for tool wrappers and sandbox boundaries
* Integration tests for connectors (mock/live)
* Replay tests for runs (recorded fixtures)
* Determinism tests (time, idempotency)
* CI expectations for PRs
* “golden run” regression suite

**Rationale**

* Self-healing requires a harness; tests become your safety net.
* OSS needs a clear contribution quality standard.

---

## 16) Extensibility: adding tools, connectors, triggers, and UI renderers

**Cover**

* How to add a tool (API schema, logging, permissions)
* How to add a connector (OAuth + tool mapping)
* How to add a trigger/event source (inbox routing)
* How to add custom UI renderers for notifications
* Versioning and compatibility rules

**Expand**

* You already have “chat_events render arbitrary notifications”.

**Rationale**

* This is the contributor on-ramp.
* Clear extension patterns reduce architectural entropy.

---

## 17) OSS project governance and contribution workflow

**Cover**

* Repo structure and module boundaries
* Issue/PR templates aligned with philosophy (tradeoffs explicit)
* Design RFC process (lightweight)
* Security reporting
* Roadmap and “won’t do” list
* Licensing notes (and expectations for third-party deps)

**Rationale**

* Philosophy must be enforced socially, not just technically.
* OSS thrives when contribution paths are clear and disputes have process.

---

## 18) Glossary (seriously useful)

**Cover**

* Automation, task, workflow, script, run, thread, chat_event, inbox item
* Planner vs executor vs maintainer
* Action-needed vs failed vs paused
* Repair vs retry vs replay
* Capability vs resource permission

**Rationale**

* Reduces cognitive load for new contributors.
* Prevents miscommunication in issues/PRs.

---

### Suggested doc structure (top-level)

* `/docs/01-philosophy.md`
* `/docs/02-ux-model.md`
* `/docs/03-data-model.md`
* `/docs/04-runtime-planner-executor-maintainer.md`
* `/docs/05-sandbox-quickjs.md`
* `/docs/06-tools-api.md`
* `/docs/07-connectors-auth.md`
* `/docs/08-scheduler-routing.md`
* `/docs/09-failure-repair.md`
* `/docs/10-intent-contract.md`
* `/docs/11-permissions.md`
* `/docs/12-observability-cost.md`
* `/docs/13-security.md`
* `/docs/14-deployment.md`
* `/docs/15-testing.md`
* `/docs/16-extensibility.md`
* `/docs/17-oss-governance.md`
* `/docs/18-glossary.md`

