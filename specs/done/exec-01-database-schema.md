# exec-01: Database Schema for Execution Model

## Goal

Add new tables and extend existing tables to support the event-driven execution model with topics, handlers, and mutation tracking.

## New Tables

### `topics` table

Topic definitions within a workflow.

```sql
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  name TEXT NOT NULL,           -- Topic name within workflow (e.g., "email.received")
  created_at INTEGER NOT NULL,
  UNIQUE(workflow_id, name)
);

SELECT crsql_as_crr('topics');
```

### `events` table

Events in topic streams.

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,    -- Denormalized for efficient queries
  message_id TEXT NOT NULL,     -- Caller-provided or host-generated, unique within topic
  title TEXT NOT NULL,          -- Human-readable title (required for observability)
  payload TEXT NOT NULL,        -- JSON payload
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, reserved, consumed, skipped
  reserved_by_run_id TEXT,      -- Consumer run that reserved this event (if reserved)
  created_by_run_id TEXT,       -- Producer run that created this event
  attempt_number INTEGER NOT NULL DEFAULT 1,  -- For tracking reprocessing
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(topic_id, message_id)  -- For idempotent publishing
);

CREATE INDEX idx_events_topic_status ON events(topic_id, status);
CREATE INDEX idx_events_workflow ON events(workflow_id);

SELECT crsql_as_crr('events');
```

### `handler_runs` table

Granular handler execution records.

```sql
CREATE TABLE handler_runs (
  id TEXT PRIMARY KEY,
  script_run_id TEXT NOT NULL,  -- FK to script_runs (session container)
  workflow_id TEXT NOT NULL,
  handler_type TEXT NOT NULL,   -- 'producer' or 'consumer'
  handler_name TEXT NOT NULL,   -- Name of handler (e.g., "pollEmail", "processEmail")

  -- Phase tracking (state machine)
  phase TEXT NOT NULL DEFAULT 'pending',  -- pending, preparing, prepared, mutating, mutated, emitting, committed, suspended, failed, executing (for producers)
  prepare_result TEXT,          -- JSON: { reservations, data, ui }

  -- State management
  input_state TEXT,             -- JSON: State received from previous run
  output_state TEXT,            -- JSON: State returned by handler

  -- Timestamps and metadata
  start_timestamp TEXT NOT NULL,
  end_timestamp TEXT,
  error TEXT,
  error_type TEXT,              -- auth, permission, network, logic
  cost INTEGER DEFAULT 0,       -- Microdollars
  logs TEXT                     -- JSON array of log entries
);

CREATE INDEX idx_handler_runs_script_run ON handler_runs(script_run_id);
CREATE INDEX idx_handler_runs_workflow ON handler_runs(workflow_id);
CREATE INDEX idx_handler_runs_phase ON handler_runs(phase);

SELECT crsql_as_crr('handler_runs');
```

### `mutations` table

Mutation ledger for tracking external side effects.

```sql
CREATE TABLE mutations (
  id TEXT PRIMARY KEY,
  handler_run_id TEXT NOT NULL UNIQUE,  -- FK to handler_runs (1:1, at most one mutation per handler run)
  workflow_id TEXT NOT NULL,    -- Denormalized for queries

  -- Mutation identity
  tool_namespace TEXT,          -- e.g., "Gmail", "Sheets" (filled when tool called)
  tool_method TEXT,             -- e.g., "send", "appendRow"
  params TEXT,                  -- JSON: Mutation parameters (for observability & reconciliation)
  idempotency_key TEXT,         -- Tool-generated key for reconciliation (if supported)

  -- Status tracking (state machine from doc 13)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, in_flight, applied, failed, needs_reconcile, indeterminate
  result TEXT,                  -- JSON: Result if applied
  error TEXT,                   -- Error message/details

  -- Reconciliation tracking (for future use)
  reconcile_attempts INTEGER NOT NULL DEFAULT 0,
  last_reconcile_at INTEGER,
  next_reconcile_at INTEGER,

  -- User resolution (for indeterminate)
  resolved_by TEXT,             -- 'user_skip', 'user_retry', 'user_assert_failed'
  resolved_at INTEGER,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_mutations_handler_run ON mutations(handler_run_id);
CREATE INDEX idx_mutations_workflow ON mutations(workflow_id);
CREATE INDEX idx_mutations_status ON mutations(status);

SELECT crsql_as_crr('mutations');
```

### `handler_state` table

Persistent state per handler.

```sql
CREATE TABLE handler_state (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  handler_name TEXT NOT NULL,   -- Producer or consumer name
  state TEXT NOT NULL,          -- JSON state object
  updated_at INTEGER NOT NULL,
  updated_by_run_id TEXT NOT NULL,
  UNIQUE(workflow_id, handler_name)
);

SELECT crsql_as_crr('handler_state');
```

## Extend Existing Tables

### `script_runs` table

Add session-related columns:

```sql
ALTER TABLE script_runs ADD COLUMN trigger TEXT;              -- 'schedule', 'manual', 'event'
ALTER TABLE script_runs ADD COLUMN handler_run_count INTEGER DEFAULT 0;
```

### `workflows` table

Add handler config and scheduling columns:

```sql
ALTER TABLE workflows ADD COLUMN handler_config TEXT;         -- JSON: extracted { topics, producers, consumers }
ALTER TABLE workflows ADD COLUMN consumer_sleep_until INTEGER; -- Backoff timestamp for empty reservations
```

## Implementation

1. Create migration file `packages/db/src/migrations/v36.ts`
2. Add all CREATE TABLE statements
3. Add ALTER TABLE statements
4. Update migration index to include v36
5. Create store classes:
   - `TopicStore` - CRUD for topics
   - `EventStore` - CRUD for events, status transitions, reservation
   - `HandlerRunStore` - CRUD for handler_runs, phase transitions
   - `MutationStore` - CRUD for mutations, status transitions
   - `HandlerStateStore` - get/set state per handler

## Testing

- Verify migration runs without errors
- Test UNIQUE constraints (topic name, event messageId, handler_run mutation)
- Test indexes are created
- Test CRR sync works for new tables
