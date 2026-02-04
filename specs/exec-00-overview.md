# Execution Model Fix Specs - Overview

## Summary

These specs fix discrepancies between the updated docs (especially 16-scheduling.md, 06b-consumer-lifecycle.md) and the existing exec-* implementation specs.

The docs were recently updated to properly define:
- Scheduler semantics and state
- Run status as orthogonal to phase
- Retry chains with `retry_of` linking
- `wakeAt` in PrepareResult
- Failure classification mapping to run statuses
- Producer queuing and coalescing

## Gaps Identified

| Gap | Doc Reference | Current State |
|-----|---------------|---------------|
| Phase vs Status conflation | 06b, 16 | `phase` includes 'failed', 'suspended' |
| No `retry_of` column | 16 (Run Records) | Runs updated in place, no chain |
| No `wakeAt` in PrepareResult | 16 (wakeAt Hint) | Not implemented |
| No dirty/queued flags | 16 (Scheduler State) | Not implemented |
| Generic error handling | 09, 16 | No mapping to run statuses |
| No producer queuing | 16 (Producer Scheduling) | Runs skip when busy |
| No priority ordering | 16 (Priority) | First-come-first-served |

## New Specs

| # | Spec | Description | Dependencies |
|---|------|-------------|--------------|
| 09 | [exec-09-run-status-separation](./exec-09-run-status-separation.md) | Separate `status` from `phase` in handler_runs | - |
| 10 | [exec-10-retry-chain](./exec-10-retry-chain.md) | Add `retry_of` column, phase reset rules | 09 |
| 11 | [exec-11-scheduler-state](./exec-11-scheduler-state.md) | Implement wakeAt, dirty/queued flags | 09, 10 |
| 12 | [exec-12-failure-classification](./exec-12-failure-classification.md) | Map errors to run statuses, handling paths | 09 |
| 13 | [exec-13-producer-scheduling](./exec-13-producer-scheduling.md) | Queuing, coalescing, priority | 11 |
| 14 | [exec-14-indeterminate-mutations](./exec-14-indeterminate-mutations.md) | Handle uncertain mutations without reconciliation | 09, 12 |

## Implementation Order

### Phase 1: Foundation (exec-09, exec-12)

1. **exec-09**: Add `status` column, update phase enum
   - Migration to add status column
   - Update state machine to use status
   - Migrate existing data

2. **exec-12**: Failure classification
   - Create classification module
   - Map errors to run statuses
   - Implement handling paths (retry, auto-fix, escalate)

### Phase 2: Retry & Mutation Handling (exec-10, exec-14)

3. **exec-10**: Retry chain
   - Add `retry_of` column
   - Implement createRetryRun()
   - Implement phase reset rules
   - Update crash recovery

4. **exec-14**: Indeterminate mutations
   - Handle uncertain mutations without reconciliation
   - User resolution flow (happened/didn't happen/skip)
   - Crash recovery for in_flight mutations

### Phase 3: Scheduler (exec-11, exec-13)

5. **exec-11**: Consumer scheduling & wakeAt
   - Add wakeAt to PrepareResult
   - Per-consumer `wake_at` in handler_state
   - Consumer `dirty` flag (in-memory)
   - Record wakeAt on prepare commit

6. **exec-13**: Producer scheduling
   - Per-producer `producer_schedules` table
   - Producer `queued` flag (in-memory)
   - Coalesce multiple triggers
   - Restart recovery

**Note**: exec-11 and exec-13 share a unified `SchedulerStateManager` class:
- Consumer state: `dirty` flag (new events arrived)
- Producer state: `queued` flag (schedule fired while busy)

## Key Decisions

### 1. Status Column vs New Table

**Decision**: Add `status` column to `handler_runs` table.

Rationale: Status is a property of the run, not a separate entity. Adding a column is simpler than creating a separate status tracking table.

### 2. Per-Consumer wakeAt

**Decision**: Add `wake_at` column to `handler_state` table (per-consumer).

Rationale: Multiple consumers may have different wake times (e.g., daily digest at 9am vs batch timeout in 1 hour). Per-workflow storage would lose one consumer's wakeAt when another commits. The doc explicitly shows wakeAt in the "Consumer" column of the Scheduler State table.

### 3. Reconciliation Handling

**Decision**: Mark uncertain mutations as `indeterminate` and set status to `paused:reconciliation`. Do NOT auto-retry.

Rationale: Per the user's note, reconciliation is explicitly not implemented yet. Uncertain failures immediately mark as indeterminate and wait for user action.

### 4. Scheduler State Persistence

**Decision**: Keep dirty/queued flags in memory, recover from DB on restart.

Rationale: From doc - "These flags change frequently... Persisting them would add write overhead for state that's easily recoverable."

### 5. Concurrency Model

**Decision**: Single-threaded scheduler is the locking mechanism.

The scheduler checks `hasActiveRun(workflowId)` before starting any handler. No explicit locks needed.

## Performance Optimizations

### Batch Queries (avoid N+1)

| Store | Method | Purpose |
|-------|--------|---------|
| `HandlerStateStore` | `getForWorkflow(workflowId)` | Get all handler states in one query |
| `EventStore` | `countPendingByTopic(workflowId, topics)` | Count pending events grouped by topic |
| `ProducerScheduleStore` | `getForWorkflow(workflowId)` | Get all producer schedules in one query |

### Config Cache

`ConfigCache` avoids repeated `JSON.parse(workflow.handler_config)`:
- Cache keyed by `workflowId`
- Invalidated when `workflow.updated_at` changes
- Used by scheduler and session orchestration

## Database Changes Summary

```sql
-- exec-09: Status separation
ALTER TABLE handler_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- exec-10: Retry chain
ALTER TABLE handler_runs ADD COLUMN retry_of TEXT;
CREATE INDEX idx_handler_runs_retry_of ON handler_runs(retry_of);

-- exec-11: Per-consumer wakeAt
ALTER TABLE handler_state ADD COLUMN wake_at INTEGER;
-- Note: workflows.consumer_sleep_until can be deprecated (was unused)

-- exec-13: Per-producer scheduling
CREATE TABLE producer_schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workflow_id, producer_name)
);
-- Note: workflows.next_run_timestamp can be deprecated

-- exec-14: No changes needed
-- Uses existing mutations.status ('indeterminate'), resolved_by, resolved_at
```

## Related Existing Specs

These new specs build on and may require updates to:

- **exec-01**: Database schema - add new columns
- **exec-06**: Handler state machine - major updates for status/retry
- **exec-07**: Session orchestration - update for priority, queuing

## Not Implemented (Explicitly Deferred)

Per the user's note about reconciliation:

1. **Reconciliation logic** (Chapter 13) - uncertain mutations go to `paused:reconciliation` and wait for user action
2. **Auto-reconciliation** - not implemented; user must manually verify and resolve
3. **Tool-specific reconciliation methods** - deferred

## Testing Strategy

1. **Unit tests** for each module:
   - Failure classification
   - Phase reset rules
   - Scheduler state management

2. **Integration tests**:
   - Full retry chain flow
   - wakeAt scheduling
   - Producer coalescing

3. **Crash recovery tests**:
   - Restart with active runs
   - Restart with missed schedules
   - Restart with pending wakeAt

## References

- docs/dev/06-execution-model.md
- docs/dev/06a-topics-and-handlers.md
- docs/dev/06b-consumer-lifecycle.md
- docs/dev/09-failure-repair.md
- docs/dev/15-host-policies.md
- docs/dev/16-scheduling.md
