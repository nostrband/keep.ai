# 08. Connectors and Authentication Model

This document describes how Keep.AI integrates with external services (“connectors”), how authentication is handled, and why the system is designed this way.

Connectors are one of the most security-sensitive and failure-prone parts of the system. The design prioritizes:

* explicit responsibility boundaries
* safe delegation (not silent escalation)
* deterministic execution
* clear recovery paths for auth failures
* OSS audibility and extensibility

---

## What is a connector?

A **connector** represents a trusted integration between Keep.AI and an external service (e.g. Gmail, GitHub, Slack).

A connector provides:

* an authenticated client for an external API
* a set of **sandbox tools** backed by that client
* helpers for reconciliation and idempotency
* a clearly scoped capability surface
* structured error signaling (especially for auth failures)

Connectors are **not**:

* generic HTTP clients
* arbitrary credential stores
* opaque SDK wrappers

They are explicit, typed, and policy-enforced integration points.

---

## Design goals

### 1. Delegation without implicit trust

When a user connects an external account, they are delegating limited authority to the system.

The system must:

* never silently expand scope
* never guess how to recover auth failures
* always surface required human actions explicitly

### 2. “Boring” execution

Once authenticated:

* connector calls must be deterministic
* retries must be safe (idempotent where applicable)
* side effects must not be duplicated accidentally

LLMs never make connector calls without runtime supervision and logging, and never have access to raw credentials.

### 3. Explicit failure states

Authentication failures are **not repairable by the system**.

They must:

* halt execution
* enter an “action-needed” state
* be resolved explicitly by the user

This is non-negotiable.

---

## Connector lifecycle (high level)

1. **User initiates connection**
2. **Authentication flow completes** (e.g. OAuth)
3. **Connector configuration is stored locally**
4. **Connector is validated (“check”)**
5. **Sandbox tools become available to planners and executors**
6. **Connector is used by deterministic scripts**
7. **Failures are classified and routed**

Each stage is described in detail below.

---

## Authentication flows

### Supported authentication types

> <to be filled with supported auth mechanisms>

Examples:

* OAuth 2.0 (authorization code flow)
* OAuth 2.0 with refresh tokens
* API key / token (where applicable)
* Service accounts (future)

Each connector declares:

* auth type
* required scopes
* refresh behavior
* revocation semantics

---

### OAuth-based connectors

For OAuth connectors (e.g. Gmail):

1. User clicks **Connect**
2. System initiates OAuth flow
3. User approves scopes with provider
4. Provider redirects back with auth code
5. Tokens are exchanged and stored locally
6. Connector enters “connected” state

Important properties:

* Tokens are stored **locally**, encrypted at rest
* Tokens are never sent to remote control clients
* Scope set is explicit and minimal

> <to be filled with OAuth callback handling details>

---

## Connector configuration storage

Each connector instance has a persisted configuration containing:

* connector type (e.g. `gmail`)
* account identifier (opaque to scripts)
* auth material (encrypted)
* granted scopes
* metadata (creation time, last checked time, etc.)

Properties:

* configurations are local-first
* no shared global credential store
* each connector instance is explicit

> <to be filled with schema / table references>

---

## Connector validation (“Check”)

Every connector exposes a **Check** operation.

Purpose:

* validate credentials
* verify scopes
* fail fast on revoked or expired tokens

Check behavior:

* invoked explicitly by user
* invoked implicitly before execution when needed
* never auto-fixes auth issues

Outcomes:

* ✅ valid
* ❌ invalid → classified as auth failure → action-needed

This prevents “half-working” automations.

---

## Connector clients

A **connector client** is the runtime object used by tools and scripts to interact with an external service.

Properties:

* instantiated per run
* bound to a specific connector configuration
* scoped to declared permissions
* no hidden global state

Clients are injected into:

* the planner sandbox (for exploration)
* the production execution sandbox (for deterministic calls)

> <to be filled with client instantiation details>

---

## Tools backed by connectors

Connectors expose functionality via **sandbox tools**, not raw SDK access.

Example (conceptual):

* `gmail.listMessages`
* `gmail.getMessage`
* `gmail.sendMessage`

Tool properties:

* typed input/output
* explicit side-effect classification
* structured errors
* cost accounting hooks

Scripts never receive raw credentials.

---

## Idempotency and side effects

Many connector tools perform side effects (sending emails, creating issues, posting messages).

Rules:

* side-effecting tools must support idempotency
* idempotency keys are derived from:

  * workflow id
  * run id
  * logical action id
* retries must not duplicate effects

If a connector cannot guarantee idempotency, this must be documented and constrained.

> <to be filled with idempotency implementation details>

---

## Error taxonomy for connectors

Connector errors must be classified into explicit categories:

### Authentication errors

Examples:

* token expired
* token revoked
* missing scope

Behavior:

* execution halts
* automation enters action-needed state
* user must re-authenticate or update permissions

### Transient errors

Examples:

* network timeouts
* rate limits
* temporary provider outages

Behavior:

* eligible for retry with backoff
* bounded retry policy

### Permanent API errors

Examples:

* invalid request
* unsupported operation
* resource not found (depending on context)

Behavior:

* forwarded to repair pipeline or surfaced as failure

The connector layer is responsible for producing structured error signals — not heuristics in higher layers.

---

## Action-needed UX for auth failures

Authentication failures are **human-action-required by definition**.

System behavior:

* pause affected runs
* generate a notification in the action-needed inbox
* describe exactly what action is required
* resume only after successful re-authentication

Auth failures are never:

* retried indefinitely
* sent to LLM repair
* silently ignored

> <to be filled with action-needed payload examples>

---

## Permissions and scope boundaries

Each connector declares:

* allowed operations
* required scopes
* side-effect classification

Execution is constrained by:

* connector scope
* workflow-level permissions
* future per-resource permissions

The planner may *discover* that additional permissions are needed, but:

* it cannot grant them
* it must request user approval

This keeps authority escalation explicit.

---

## Security considerations

Key security properties:

* credentials stored locally and encrypted
* no credential access from remote control clients
* sandbox isolation between scripts
* no raw HTTP access to connector secrets
* clear revocation path

Threats explicitly considered:

* token exfiltration
* replay attacks via retries
* privilege escalation via script changes
* connector misuse after intent change

> <to be filled with encryption and key management details>

---

## Adding a new connector (contributor guide)

High-level steps:

1. Define connector metadata (name, auth type, scopes)
2. Implement auth flow
3. Define connector client
4. Expose sandbox tools
5. Implement error classification
6. Implement idempotency strategy
7. Add validation (“check”)
8. Add tests (mock + optional live)

Design requirements:

* no hidden capabilities
* no raw SDK exposure
* explicit errors
* documented side effects

> <to be filled with code pointers / examples>

---

## Why this design

This connector model exists to support **delegation**, not convenience.

* Users delegate limited authority
* The system executes deterministically
* Humans intervene only when authority must change
* Failures are explicit, not ambiguous

If connectors silently recover auth failures, auto-expand scopes, or blur responsibility, the delegation contract breaks.

---

## Summary

Connectors are:

* explicit
* local-first
* permissioned
* observable
* boring in execution

They are one of the primary trust boundaries in Keep.AI — and treated accordingly.

