# Permission System Data Model

Database schema for the permission system described in `docs/dev/11-permissions.md`.

## Design Principles

- Only **host-enforceable** grants are stored. Best-effort/semantic constraints live in the Intent Spec.
- Permission envelopes are **immutable once resolved** (approved/rejected). Changes create new envelopes.
- The sequence of envelopes per workflow **is** the audit trail. No separate audit log table.
- Runtime usage is computed from existing tables (`mutations`, `handler_runs`), not separate counters.

## Tables

### `permission_envelopes`

Versioned, immutable policy container. One per workflow major version (production) or per planner session (ephemeral).

```sql
CREATE TABLE IF NOT EXISTS permission_envelopes (
  id               TEXT    PRIMARY KEY NOT NULL DEFAULT '',
  workflow_id      TEXT    NOT NULL DEFAULT '',   -- FK to workflows
  version          INTEGER NOT NULL DEFAULT 0,    -- monotonic per workflow
  type             TEXT    NOT NULL DEFAULT '',    -- 'production' | 'session'
  session_id       TEXT    NOT NULL DEFAULT '',    -- chat/session id for type='session', empty for production
  status           TEXT    NOT NULL DEFAULT '',    -- 'proposed' | 'approved' | 'rejected' | 'superseded'
  proposed_by      TEXT    NOT NULL DEFAULT '',    -- 'compilation' | 'planner' | 'user'
  approved_by      TEXT    NOT NULL DEFAULT '',    -- 'user' | empty if not approved
  diff_summary     TEXT    NOT NULL DEFAULT '',    -- human-readable diff vs previous envelope (JSON)
  created_at       INTEGER NOT NULL DEFAULT 0,
  approved_at      INTEGER NOT NULL DEFAULT 0,    -- 0 if not yet approved
  superseded_at    INTEGER NOT NULL DEFAULT 0     -- 0 if current
);

CREATE INDEX IF NOT EXISTS idx_perm_env_workflow ON permission_envelopes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_perm_env_workflow_status ON permission_envelopes(workflow_id, status);
CREATE INDEX IF NOT EXISTS idx_perm_env_session ON permission_envelopes(session_id);

SELECT crsql_as_crr('permission_envelopes');
```

**Status lifecycle:** `proposed` → `approved` | `rejected`. When a new envelope is approved, the previous one becomes `superseded`.

**Production vs session:** Production envelopes are persistent and enforced for all workflow runs. Session envelopes are ephemeral, bound to a planner chat, and cleaned up when the session ends. Planner access does not imply production authority.

**Version:** For production envelopes, matches the script major version. For session envelopes, a sequence number.

### `permission_grants`

Individual capability grants within an envelope. Each row = "this workflow is allowed to use this capability, scoped to these resources, with these limits."

```sql
CREATE TABLE IF NOT EXISTS permission_grants (
  id               TEXT    PRIMARY KEY NOT NULL DEFAULT '',
  envelope_id      TEXT    NOT NULL DEFAULT '',   -- FK to permission_envelopes
  capability       TEXT    NOT NULL DEFAULT '',   -- tool capability e.g. 'gmail.sendMessage', or '*' for envelope-wide
  risk_tier        TEXT    NOT NULL DEFAULT '',   -- 'low' | 'medium' | 'high' (denormalized from tool schema)
  scope            TEXT    NOT NULL DEFAULT '{}', -- JSON: enforceable resource restrictions e.g. {"channel":"#ops"}
  connection_id    TEXT    NOT NULL DEFAULT '',   -- FK to connections, binds grant to specific account
  limits           TEXT    NOT NULL DEFAULT '{}', -- JSON: enforced limits e.g. {"per_run":5,"per_day":20}
  UNIQUE(envelope_id, capability, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_perm_grants_envelope ON permission_grants(envelope_id);
CREATE INDEX IF NOT EXISTS idx_perm_grants_capability ON permission_grants(capability);

SELECT crsql_as_crr('permission_grants');
```

**Capability:** Uses `namespace.operation` format matching tool declarations (e.g. `gmail.listMessages`, `slack.postMessage`). `*` represents envelope-wide grants/limits not tied to a specific tool.

**Scope:** JSON object with resource restrictions. Only enforceable scopes are stored — the runtime gates tool calls by checking parameters against scope dimensions. Informational/semantic restrictions belong in the Intent Spec. Empty `{}` means unrestricted within the capability.

**Connection ID:** Binds the grant to a specific connection from the `connections` table (e.g. "Work Gmail" vs "Personal Gmail"). Empty means any connection for that service.

**Limits:** JSON object with enforced rate/budget limits. Keys are predefined limit types, values are numeric.

Supported limit keys:
- `per_run` — max invocations per workflow run
- `per_day` — max invocations per calendar day
- `per_week` — max invocations per week
- `token_budget_day` — max LLM token spend per day (for AI-assisted tools)
- `runtime_ms` — max execution time

Empty `{}` means no limits.

**Examples:**

| capability | scope | limits | meaning |
|---|---|---|---|
| `slack.postMessage` | `{"channel":"#ops"}` | `{"per_run":1,"per_day":5}` | post to #ops, max 1/run, 5/day |
| `gmail.sendMessage` | `{}` | `{"per_day":20}` | send email, max 20/day |
| `gmail.listMessages` | `{}` | `{}` | read email, no limits |
| `*` | `{}` | `{"per_run":10,"token_budget_day":500}` | envelope-wide: 10 mutations/run, 500 tokens/day |

## Extended Columns on Existing Tables

### `scripts.envelope_id`

Links each script version to the permission envelope it runs under.

```sql
ALTER TABLE scripts ADD COLUMN envelope_id TEXT NOT NULL DEFAULT '';
```

The runtime loads `envelope_id` from the active script to determine enforced policy.

### `mutations.envelope_id`

Denormalized link from each mutation to the envelope that authorized it. Enables direct "why was this allowed?" queries without multi-hop joins.

```sql
ALTER TABLE mutations ADD COLUMN envelope_id TEXT NOT NULL DEFAULT '';
```

Set at mutation creation time by the runtime. The canonical path `mutation → handler_run → script_run → script → envelope_id` exists but requires 3 joins. This column makes the most common audit query zero-join.

## Relationships

```
workflows ──1:N──→ permission_envelopes (via workflow_id)
                        │
                        └──1:N──→ permission_grants (via envelope_id)

scripts.envelope_id ──→ permission_envelopes.id
mutations.envelope_id ──→ permission_envelopes.id
permission_grants.connection_id ──→ connections.id
```

## What Is NOT Stored

- **Tool permission schemas** — declared in code by each connector/tool. The DB stores granted permissions, not available ones.
- **Best-effort/semantic constraints** — live in the Intent Spec (e.g. "only email internal recipients"). Only host-enforceable scopes go into grants.
- **Usage counters** — current usage against limits is computed from `mutations` and `handler_runs` at enforcement time. No separate counter to drift.
- **Full permission-check audit log** — handler_runs.logs already captures tool calls. Enterprise-grade per-check audit is a future extension.

## Runtime Enforcement Flow

```
Script execution starts
  → Load active script → get envelope_id
  → Load permission_grants WHERE envelope_id = ?
  → Cache as the run's policy

Tool wrapper receives call
  → Check: grant exists for this capability?
  → Check: scope matches call parameters?
  → Check: connection_id matches?
  → Check: limits within budget? (count from mutations/handler_runs)
  → Allow or block (abort on block)

Mutation created
  → Set mutations.envelope_id from active envelope
```

## Session Envelope Cleanup

When a planner session ends, the application deletes envelopes with `type='session'` and matching `session_id`, along with their grants. Session envelopes are never used by production runs.
