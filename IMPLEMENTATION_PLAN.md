# Keep.AI Implementation Plan - Execution Model Fix

## Overview

This plan addresses gaps between the current implementation and the updated execution model specifications (`specs/exec-*`). The specs fix discrepancies between documentation (16-scheduling.md, 06b-consumer-lifecycle.md) and existing implementation.

**Current Schema Version**: v41
**Target**: Simple, lovable, complete v1 Keep.AI release
**Last Verified**: 2026-02-04

---

## Implementation Status Summary

| Spec | Description | Status | Completion | Priority |
|------|-------------|--------|------------|----------|
| exec-09 | Run Status Separation | COMPLETE | 100% | P1 - Critical (Blocker) |
| exec-10 | Retry Chain | COMPLETE | 100% | P1 - Critical |
| exec-11 | Scheduler State & wakeAt | NOT STARTED | 0% | P2 - High |
| exec-12 | Failure Classification | PARTIAL | ~40% | P1 - Critical |
| exec-13 | Producer Scheduling | NOT STARTED | 0% | P2 - High |
| exec-14 | Indeterminate Mutations | PARTIAL | ~85% | P2 - High |

**Blocking Dependencies**:
- exec-09 COMPLETE - unblocks exec-10, exec-11, exec-12, exec-14
- exec-10 COMPLETE - unblocks exec-14 (for retry on "didn't happen")
- exec-11 blocks exec-13

---

## Phase 1: Foundation (exec-09, exec-12)

### 1.1 exec-09: Separate Run Status from Phase

**Problem**: `handler_runs.phase` includes `suspended`, `failed` which are statuses not phases. No distinction between "paused for retry" vs "failed permanently".

**Current State (100% Complete - COMPLETE)**:

Implementation completed with the following changes:

1. **Database Migrations**:
   - [x] Migration v39: Added `status TEXT NOT NULL DEFAULT 'active'` column to `handler_runs`
   - [x] Migration v40: Data migration for existing records (committed -> committed, failed -> failed:logic, suspended -> paused:reconciliation)

2. **Type System**:
   - [x] Added `RunStatus` type with all statuses: `'active' | 'paused:transient' | 'paused:approval' | 'paused:reconciliation' | 'failed:logic' | 'failed:internal' | 'committed' | 'crashed'`
   - [x] Added helper functions: `isTerminalStatus()`, `isPausedStatus()`, `isFailedStatus()`
   - [x] Updated `HandlerRun` interface to include `status: RunStatus`
   - [x] Updated `UpdateHandlerRunInput` to include `status?: RunStatus`

3. **State Machine Updates** (`handler-state-machine.ts`):
   - [x] Added new `pauseRun()` function that keeps phase and sets status
   - [x] Added `errorTypeToRunStatus()` mapping function
   - [x] Updated all call sites to use new pauseRun semantics

4. **Session Orchestration Updates** (`session-orchestration.ts`):
   - [x] Updated failure/paused detection to check status instead of phase

5. **Query Updates**:
   - [x] Updated all queries to use `status='active'` instead of `phase NOT IN (...)`

6. **Tests**:
   - [x] All tests pass

**Dependencies**: None (UNBLOCKS exec-10, exec-11, exec-12, exec-14)
**Tests**: `packages/tests/src/handler-run-store.test.ts`, `packages/tests/src/handler-state-machine.test.ts`

---

### 1.2 exec-12: Failure Classification and Run Status Mapping

**Problem**: Error types exist but don't map to run statuses. `ensureClassified()` and `classifyGenericError()` use unreliable pattern matching. Unclassified errors should be InternalError (bug in our code), not LogicError.

**Verified Code Locations**:
- `packages/proto/src/errors.ts:1-178` - ClassifiedError hierarchy (IMPLEMENTED ✓)
- `packages/proto/src/errors.ts:179-238` - classifyHttpError, classifyFileError (IMPLEMENTED ✓)
- `packages/proto/src/errors.ts:240-286` - classifyGenericError (NOT marked @deprecated - uses pattern matching)
- `packages/proto/src/errors.ts:294-309` - ensureClassified (NOT marked @deprecated - falls back to LogicError)
- `packages/proto/src/errors.ts:307-308` - Default fallback to LogicError (WRONG - should be InternalError)
- `packages/agent/src/handler-state-machine.ts:88-103` - errorTypeToHandlerErrorType (PARTIAL - maps to DB type only)
- `packages/agent/src/handler-state-machine.ts:409,508,672,808,898` - ensureClassified calls (5 total in state machine)
- `packages/agent/src/session-orchestration.ts:386` - ensureClassified call (1 total in orchestration)
- `packages/proto/src/errors.ts:342-362` - classifyGoogleApiError (CORRECT ✓)
- `packages/proto/src/errors.ts:375-410` - classifyNotionError (CORRECT ✓)

**Current State (~40% Complete - PARTIAL)**:
- [x] `ClassifiedError` base class EXISTS with `AuthError`, `PermissionError`, `NetworkError`, `LogicError`, `InternalError`
- [x] `classifyHttpError()` EXISTS and maps HTTP status codes → ClassifiedError
- [x] `classifyFileError()` EXISTS and maps Node.js errno → ClassifiedError
- [x] `classifyGoogleApiError()` EXISTS for Google APIs
- [x] `classifyNotionError()` EXISTS for Notion API
- [x] `errorTypeToHandlerErrorType()` EXISTS at line 88 (maps to DB type only)
- [ ] `classifyGenericError()` NOT marked @deprecated (still used in 13 tool files)
- [ ] `ensureClassified()` NOT marked @deprecated (still used in 5 places in handler-state-machine.ts)
- [ ] `ensureClassified()` still used in 1 place in session-orchestration.ts (line 386)
- [ ] Unclassified errors become LogicError at line 307-308 (wrong - should be InternalError)
- [ ] No `errorTypeToRunStatus()` mapping function
- [ ] No failure routing functions (scheduleRetry, triggerAutoFix, pauseForUserAction)
- [ ] `failure-handling.ts` module does NOT exist

**Tool Files Using classifyGenericError() (13 files verified)**:
1. `packages/agent/src/tools/get-weather.ts`
2. `packages/agent/src/tools/audio-explain.ts`
3. `packages/agent/src/tools/pdf-explain.ts`
4. `packages/agent/src/tools/text-generate.ts`
5. `packages/agent/src/tools/text-summarize.ts`
6. `packages/agent/src/tools/text-classify.ts`
7. `packages/agent/src/tools/text-extract.ts`
8. `packages/agent/src/tools/images-transform.ts`
9. `packages/agent/src/tools/images-explain.ts`
10. `packages/agent/src/tools/images-generate.ts`
11. `packages/agent/src/tools/web-download.ts`
12. `packages/agent/src/tools/web-fetch.ts`
13. `packages/agent/src/tools/web-search.ts`

**Implementation Tasks**:
- [ ] **Create** `packages/agent/src/failure-handling.ts` (NEW):
  - [ ] `errorTypeToRunStatus(errorType: ErrorType): RunStatus` mapping:
    - auth → 'paused:approval'
    - permission → 'paused:approval'
    - network → 'paused:transient'
    - logic → 'failed:logic'
    - internal → 'failed:internal'
  - [ ] `getRunStatusForError(error: unknown): { status: RunStatus; error: ClassifiedError }` - treats unclassified as InternalError
  - [ ] `routeFailure(run, status, error)` - routes to retry/auto-fix/escalate
  - [ ] `scheduleRetry(run, error)` with exponential backoff
  - [ ] `triggerAutoFix(run, error)` for logic errors
  - [ ] `pauseForUserAction(run, error)` for auth/permission
  - [ ] `pauseForInternal(run, error)` for internal bugs
  - [ ] `calculateBackoff(retryCount)` - exponential with jitter
- [ ] **Deprecate** in `packages/proto/src/errors.ts`:
  - [ ] Mark `ensureClassified()` at line 294 as `@deprecated`
  - [ ] Mark `classifyGenericError()` at line 240 as `@deprecated`
  - [ ] Change default fallback at line 307-308 from LogicError to InternalError
- [ ] **Update** `packages/agent/src/handler-state-machine.ts`:
  - [ ] Replace 5 `ensureClassified()` calls at lines 409,508,672,808,898
  - [ ] Use `getRunStatusForError()` to get status
  - [ ] Use `routeFailure()` to handle errors
- [ ] **Update** `packages/agent/src/session-orchestration.ts`:
  - [ ] Replace `ensureClassified()` call at line 386
- [ ] **Update** all 13 tool files using `classifyGenericError()`:
  - [ ] Each tool should either throw explicit ClassifiedError or throw InternalError for unexpected errors

**Dependencies**: exec-09 (for RunStatus type)
**Tests**: Unit tests for failure classification, integration tests for retry/escalation flows

---

## Phase 2: Retry & Mutation Handling (exec-10, exec-14)

### 2.1 exec-10: Retry Chain and Phase Reset Rules

**Problem**: Each retry should be a separate run record linked via `retry_of`. Current implementation has no `retry_of` column, doesn't create new runs on retry, doesn't implement phase reset rules.

**Current State (100% Complete - COMPLETE)**:

Implementation completed with the following changes:

1. **Database Migrations**:
   - [x] Migration v41: Added `retry_of TEXT NOT NULL DEFAULT ''` column to `handler_runs`
   - [x] Created index `idx_handler_runs_retry_of` for retry chain queries

2. **Type System & Store** (`packages/db/src/handler-run-store.ts`):
   - [x] Added `retry_of: string` field to `HandlerRun` interface
   - [x] Added `retry_of?: string`, `phase?: HandlerRunPhase`, `prepare_result?: string` to `CreateHandlerRunInput`
   - [x] Updated `create()` to handle new fields
   - [x] Updated `mapRowToHandlerRun()` to include retry_of
   - [x] Added `getRetryChain(runId)` - returns all runs in chain (oldest first)
   - [x] Added `findLatestInChain(runId)` - gets most recent attempt
   - [x] Added `getRetriesOf(runId)` - gets direct retries of a run

3. **Phase Reset Rules** (`packages/agent/src/handler-state-machine.ts`):
   - [x] Added `shouldCopyResults(phase)` - returns true if phase === 'mutated' || phase === 'emitting'
   - [x] Added `getStartPhaseForRetry(previousPhase)` - returns 'emitting' if mutation applied, else 'preparing'
   - [x] Added `RetryReason` type: 'transient' | 'logic_fix' | 'crashed_recovery' | 'user_retry'
   - [x] Added `CreateRetryRunParams` interface
   - [x] Added `createRetryRun(params)` - atomic: mark previous with status + create new run with retry_of

4. **Crash Recovery** (`packages/agent/src/session-orchestration.ts`):
   - [x] Updated `resumeIncompleteSessions()` to properly handle crash recovery:
     - Find active runs → mark as `status: 'crashed'`
     - For non-indeterminate: create recovery run with `retry_of`
     - For indeterminate mutations (in_flight): mark `paused:reconciliation`, don't auto-retry

5. **Tests** (`packages/tests/src/handler-run-store.test.ts`):
   - [x] Added 6 new tests for retry chain functionality
   - [x] Tests for: retry_of linking, getRetryChain, findLatestInChain, getRetriesOf, starting phase, prepare_result copying
   - [x] Updated test table schemas to include retry_of column

**Dependencies**: exec-09 (for status field) - COMPLETE
**Tests**: `packages/tests/src/handler-run-store.test.ts` (retry chain tests), `packages/tests/src/session-orchestration.test.ts`

---

### 2.2 exec-14: Indeterminate Mutation Handling (Without Reconciliation)

**Problem**: Need to handle uncertain mutation outcomes without auto-reconciliation. User must manually verify and resolve.

**Verified Code Locations**:
- `packages/db/src/mutation-store.ts:15-21` - MutationStatus type (COMPLETE ✓)
- `packages/db/src/mutation-store.ts:26-29` - MutationResolution type (MISSING user_assert_applied)
- `packages/db/src/mutation-store.ts:280-289` - markIndeterminate() (COMPLETE ✓)
- `packages/db/src/mutation-store.ts:293-307` - resolve() (STORES metadata only, no logic)
- `packages/agent/src/handler-state-machine.ts:109-113` - isDefiniteFailure() (COMPLETE ✓)
- `packages/agent/src/handler-state-machine.ts:547-558` - in-flight crash detection (COMPLETE ✓)
- `packages/agent/src/handler-state-machine.ts:553,558` - suspendRun() calls (WRONG - uses phase not status)

**Current State (~85% Complete - PARTIAL)**:
- [x] `MutationStatus` type EXISTS and includes `indeterminate`
- [x] Mutation statuses: `pending`, `in_flight`, `applied`, `failed`, `needs_reconcile`, `indeterminate`
- [x] `isDefiniteFailure()` EXISTS at lines 109-113 and checks for logic/permission errors
- [x] In-flight crash detection EXISTS at lines 547-558 and marks mutations as `indeterminate`
- [x] `MutationStore.markIndeterminate()` EXISTS at lines 280-289 and works correctly
- [x] `MutationStore.resolve()` EXISTS at lines 293-307 and stores resolution metadata
- [ ] `MutationResolution` type at lines 26-29 MISSING `user_assert_applied` (only has user_skip, user_retry, user_assert_failed)
- [ ] Handler run uses `phase: 'suspended'` at lines 553,558 (should be `status: 'paused:reconciliation'`) - BLOCKED by exec-09
- [ ] No escalation record creation on indeterminate
- [ ] Workflow not paused on indeterminate (only handler suspended)
- [ ] `resolveIndeterminateMutation()` function NOT implemented (resolve() only stores metadata)
- [ ] `getMutationResultForNext()` function NOT implemented (no handling for skipped mutations)

**Implementation Tasks**:
- [ ] **Types**: Add `user_assert_applied` to `MutationResolution` type
  - File: `packages/db/src/mutation-store.ts` (line 26-29)
- [ ] **Update** indeterminate handling at line 547-558 to:
  - Set `run.status = 'paused:reconciliation'` (not `phase = 'suspended'`) - BLOCKED by exec-09
  - Pause workflow: `workflow.status = 'paused'`
- [ ] **Create** escalation record on indeterminate (future: escalation_store)
- [ ] **Implement** `resolveIndeterminateMutation()` function:
  - [ ] `'happened'` / `'user_assert_applied'` → mark applied, set `status: 'active'`, phase to `mutated`, resume execution
  - [ ] `'did_not_happen'` / `'user_assert_failed'` → mark failed, create retry run via exec-10
  - [ ] `'skip'` / `'user_skip'` → mark failed, skip events, commit run
- [ ] **Implement** `getMutationResultForNext()` function:
  - `applied` → return result
  - `failed` with `resolved_by = 'user_skip'` → return { status: 'skipped' }
  - Otherwise throw error (shouldn't reach next)

**Dependencies**: exec-09 (for `paused:reconciliation` status), exec-10 (for retry on "didn't happen")
**Tests**: Test all 3 resolution paths, test escalation creation, test workflow pause

---

## Phase 3: Scheduler (exec-11, exec-13)

### 3.1 exec-11: Scheduler State and wakeAt Implementation

**Problem**: No per-consumer wakeAt (from PrepareResult), no dirty flag tracking, wrong granularity (per-workflow instead of per-consumer).

**Verified Code Locations**:
- `packages/agent/src/handler-state-machine.ts:51-58` - PrepareResult interface (MISSING wakeAt)
- `packages/db/src/migrations/v36.ts:121-134` - handler_state table (MISSING wake_at column)
- `packages/db/src/handler-state-store.ts:143-155` - listByWorkflow() exists (aliased, OK)
- `packages/db/src/handler-state-store.ts` - MISSING updateWakeAt() method
- `packages/db/src/event-store.ts` - countPending() for single topic (N+1 queries)
- `packages/db/src/event-store.ts` - MISSING countPendingByTopic() batch method
- `packages/agent/src/session-orchestration.ts:146-180` - findConsumerWithPendingWork()
- `packages/agent/src/session-orchestration.ts:165-177` - N+1 queries for pending events (confirmed)
- `packages/agent/src/session-orchestration.ts:266-269` - JSON.parse(handler_config) no caching
- `packages/agent/src/handler-state-machine.ts:593-599` - JSON.parse(handler_config) no caching
- `packages/agent/src/scheduler-state.ts` - FILE DOES NOT EXIST
- `packages/agent/src/config-cache.ts` - FILE DOES NOT EXIST

**Current State (0% Complete - NOT STARTED)**:
- [ ] `PrepareResult` interface at lines 51-58 has NO `wakeAt` field
- [ ] `handler_state` table (v36 migration) has NO `wake_at` column
- [ ] `HandlerState` type has NO `wake_at` field
- [ ] `workflows.consumer_sleep_until` exists but wrong granularity (per-workflow, not per-consumer)
- [ ] No `updateWakeAt()` method in HandlerStateStore
- [ ] No `getConsumersWithDueWakeAt()` method in HandlerStateStore
- [ ] No `countPendingByTopic()` batch method in EventStore (N+1 queries confirmed at lines 165-177)
- [ ] `scheduler-state.ts` does NOT exist - no `SchedulerStateManager` class
- [ ] `config-cache.ts` does NOT exist - no `ConfigCache` class
- [ ] Consumer scheduling at lines 146-180 only checks for pending events, not wakeAt
- [ ] No dirty flag check (step 1 of spec missing)
- [ ] No wakeAt check (step 2 of spec missing)
- [ ] N+1 queries at lines 165-177 (should use batch query)
- [ ] Repeated JSON.parse of handler_config at lines 266-269, 593-599 (no caching)
- [ ] Migration v42 does NOT exist

**Implementation Tasks**:
- [ ] **DB Migration v42**: Add `wake_at INTEGER` column to `handler_state`
  - File: `packages/db/src/migrations/v42.ts` (NEW)
  ```sql
  ALTER TABLE handler_state ADD COLUMN wake_at INTEGER;
  ```
- [ ] **Interface**: Update `PrepareResult` at line 51-58 to include `wakeAt?: string` (ISO 8601)
  - File: `packages/agent/src/handler-state-machine.ts`
- [ ] **Interface**: Update `HandlerState` to include `wake_at: number | null`
  - File: `packages/db/src/handler-state-store.ts`
- [ ] **Store**: Add to `HandlerStateStore`:
  - [ ] Rename/alias `listByWorkflow()` to `getForWorkflow()` (or just use existing)
  - [ ] Add `updateWakeAt(workflowId, handlerName, wakeAt)` - upsert wake_at
  - [ ] Add `getConsumersWithDueWakeAt(workflowId)` - find consumers ready to wake
- [ ] **Store**: Add to `EventStore`:
  - [ ] Add `countPendingByTopic(workflowId, topicNames)` - batch query returning Map<topic, count>
- [ ] **Create** `packages/agent/src/scheduler-state.ts` (NEW):
  - [ ] `SchedulerStateManager` class with:
    - Consumer state: `dirty: boolean` (new events arrived)
    - Producer state: `queued: boolean` (schedule fired while busy)
    - Methods: `onEventPublish()`, `onConsumerCommit()`, `setConsumerDirty()`, `isConsumerDirty()`
    - Methods: `setProducerQueued()`, `isProducerQueued()`, `onProducerCommit()`
    - Method: `clearWorkflow(workflowId)`
- [ ] **Create** `packages/agent/src/config-cache.ts` (NEW):
  - [ ] `ConfigCache` class to cache parsed `WorkflowConfig` by workflowId + version
- [ ] **State Machine**: Update preparing phase:
  - [ ] Extract wakeAt from PrepareResult
  - [ ] Clamp to min/max bounds (30s - 24h)
  - [ ] Store in `handler_state.wake_at`
- [ ] **Scheduler**: Update `findConsumerWithPendingWork()` at line 146-180:
  - [ ] Check dirty flag first (in-memory)
  - [ ] Batch query handler states, check wakeAt
  - [ ] Batch query pending events by topic (replace N+1 queries at 165-177)
- [ ] **Recovery**: On restart, set `dirty=true` for consumers with pending events
- [ ] **Deploy**: On workflow deploy, set all consumer `dirty=true`

**Dependencies**: exec-09 (for status semantics)
**Tests**: Test wakeAt clamping, per-consumer wake times, dirty flag lifecycle, restart recovery

---

### 3.2 exec-13: Per-Producer Scheduling

**Problem**: Single `workflows.next_run_timestamp` shared by all producers. When Producer A runs, it affects Producer B's schedule. Need per-producer tracking.

**Verified Code Locations**:
- `packages/db/src/producer-schedule-store.ts` - FILE DOES NOT EXIST
- `packages/db/src/migrations/v42.ts` - FILE DOES NOT EXIST
- `packages/agent/src/workflow-scheduler.ts:264-402` - Scheduler tick logic
- `packages/agent/src/workflow-scheduler.ts:289-310` - Uses workflow.next_run_timestamp (WRONG granularity)
- `packages/agent/src/workflow-scheduler.ts:356-389` - Updates workflow.next_run_timestamp (WRONG)
- `packages/db/src/script-store.ts` - No producer schedule initialization on deploy
- `packages/agent/src/session-orchestration.ts:32` - SessionTrigger includes 'manual'
- `packages/agent/src/session-orchestration.ts:264-323` - executeWorkflowSession() manual trigger
- `packages/tests/src/session-orchestration.test.ts:408-431` - Manual trigger test exists

**Current State (0% Complete - NOT STARTED)**:
- [ ] `producer-schedule-store.ts` does NOT exist
- [ ] `producer_schedules` table does NOT exist
- [ ] No `ProducerScheduleStore` class
- [ ] `ProducerScheduleStore` NOT exported from `packages/db/src/api.ts`
- [ ] Single `workflow.next_run_timestamp` used for ALL producers at lines 289-310 (wrong granularity)
- [ ] When Producer A runs, updates workflow timestamp at lines 356-389 affecting all producers
- [ ] Producer schedule calculated at runtime from cron, not persisted per-producer
- [ ] No producer `queued` flag for coalescing (SchedulerStateManager doesn't exist)
- [ ] No `computeNextRunTime()` utility function
- [ ] Manual trigger framework exists (line 32, 264-323) but not integrated with per-producer scheduling
- [ ] Migration v43 does NOT exist

**Implementation Tasks**:
- [ ] **DB Migration v43**: Create `producer_schedules` table
  - File: `packages/db/src/migrations/v43.ts` (NEW)
  ```sql
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
  CREATE INDEX idx_producer_schedules_workflow ON producer_schedules(workflow_id);
  CREATE INDEX idx_producer_schedules_next_run ON producer_schedules(next_run_at);
  SELECT crsql_as_crr('producer_schedules');
  ```
- [ ] **Create** `packages/db/src/producer-schedule-store.ts` (NEW):
  - [ ] `ProducerScheduleStore` class with:
    - `initializeForWorkflow(workflowId, config)` - create/update schedules from config
    - `get(workflowId, producerName)`
    - `getForWorkflow(workflowId)` - batch query
    - `getDueProducers(workflowId)`
    - `updateAfterRun(workflowId, producerName)` - update next_run_at
    - `getNextScheduledTime(workflowId)` - MIN of all producers
    - `delete(workflowId, producerName)` - cleanup removed producers
- [ ] **Add** to `packages/db/src/api.ts`:
  - [ ] Import and export ProducerScheduleStore
- [ ] **Utils**: Add `computeNextRunTime(scheduleType, scheduleValue)`:
  - [ ] Handle 'cron' with croner library (already imported in workflow-scheduler.ts)
  - [ ] Handle 'interval' with `parseInterval()` helper
- [ ] **Scheduler State**: Use `SchedulerStateManager` from exec-11 for producer `queued` flag
- [ ] **Scheduler**: Update `workflow-scheduler.ts` tick at line 264-402:
  - [ ] Replace workflow.next_run_timestamp checks with per-producer queries
  - [ ] Check in-memory queued flag first
  - [ ] Batch query producer schedules
- [ ] **Commit**: Update `commitProducer()`:
  - [ ] Update per-producer `next_run_at` (not workflow.next_run_timestamp)
  - [ ] Clear producer `queued` flag
- [ ] **Recovery**: On restart, queue producers whose `next_run_at` has passed
- [ ] **Deploy**: On workflow deploy, initialize producer schedules with `next_run_at = now`
- [ ] **Config Update**: Handle added/removed producers on config change
- [ ] **Deprecate**: Stop using `workflows.next_run_timestamp` at line 289-310, 356-389 (keep for backwards compat)

**Dependencies**: exec-11 (for SchedulerStateManager)
**Tests**: Test independent producer schedules, queued flag coalescing, restart recovery

---

## Database Changes Summary

```sql
-- v39: exec-09 - Status separation (COMPLETE)
ALTER TABLE handler_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- v40: exec-09 - Data migration (COMPLETE)
-- Migrates existing phase values to status: committed->committed, failed->failed:logic, suspended->paused:reconciliation

-- v41: exec-10 - Retry chain (COMPLETE)
ALTER TABLE handler_runs ADD COLUMN retry_of TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_handler_runs_retry_of ON handler_runs(retry_of);

-- v42: exec-11 - Per-consumer wakeAt
ALTER TABLE handler_state ADD COLUMN wake_at INTEGER;

-- v43: exec-13 - Per-producer scheduling
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
CREATE INDEX idx_producer_schedules_workflow ON producer_schedules(workflow_id);
CREATE INDEX idx_producer_schedules_next_run ON producer_schedules(next_run_at);
SELECT crsql_as_crr('producer_schedules');
```

---

## Files to Create

| File | Purpose | Status |
|------|---------|--------|
| `packages/db/src/migrations/v39.ts` | Add status column to handler_runs | COMPLETE |
| `packages/db/src/migrations/v40.ts` | Data migration for status values | COMPLETE |
| `packages/db/src/migrations/v41.ts` | Add retry_of column to handler_runs | COMPLETE |
| `packages/db/src/migrations/v42.ts` | Add wake_at column to handler_state | NOT STARTED |
| `packages/db/src/migrations/v43.ts` | Create producer_schedules table | NOT STARTED |
| `packages/db/src/producer-schedule-store.ts` | ProducerScheduleStore class | NOT STARTED |
| `packages/agent/src/failure-handling.ts` | Error→RunStatus mapping, failure routing | NOT STARTED |
| `packages/agent/src/scheduler-state.ts` | SchedulerStateManager (dirty/queued flags) | NOT STARTED |
| `packages/agent/src/config-cache.ts` | ConfigCache for parsed WorkflowConfig | NOT STARTED |

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/db/src/handler-run-store.ts` | Add status, retry_of; update types; add retry chain queries |
| `packages/db/src/handler-state-store.ts` | Add wake_at; add batch query; add wakeAt methods |
| `packages/db/src/event-store.ts` | Add countPendingByTopic batch query |
| `packages/db/src/mutation-store.ts` | Add user_assert_applied resolution type |
| `packages/db/src/database.ts` | Import new migrations |
| `packages/db/src/api.ts` | Add ProducerScheduleStore to KeepDbApi |
| `packages/proto/src/errors.ts` | Deprecate ensureClassified, classifyGenericError |
| `packages/agent/src/handler-state-machine.ts` | Update phase/status handling; add retry logic; fix error classification |
| `packages/agent/src/session-orchestration.ts` | Replace ensureClassified; use new scheduling |
| `packages/agent/src/workflow-scheduler.ts` | Use per-producer schedules; integrate SchedulerStateManager |
| 13 tool files in `packages/agent/src/tools/` | Remove classifyGenericError usage (verified: 13 files) |

---

## Testing Strategy

1. **Unit Tests**:
   - Failure classification (errorTypeToRunStatus)
   - Phase reset rules (shouldCopyResults, getStartPhaseForRetry)
   - Scheduler state management (dirty/queued flags)
   - ConfigCache invalidation
   - ProducerScheduleStore CRUD

2. **Integration Tests**:
   - Full retry chain flow (transient → backoff → retry)
   - Logic error → auto-fix → retry with new script
   - wakeAt scheduling (consumer returns wakeAt, wakes on time)
   - Producer coalescing (schedule fires while busy → queued)
   - Mutation resolution (all 3 paths)

3. **Crash Recovery Tests**:
   - Restart with active runs → marked crashed → retry created
   - Restart with missed schedules → producers queued
   - Restart with pending wakeAt → consumers ready
   - Restart with in-flight mutation → indeterminate (no auto-retry)

---

## Not Implemented (Explicitly Deferred)

Per user's note, these are NOT part of this plan:
1. **Reconciliation logic** (Chapter 13) - uncertain mutations go to `paused:reconciliation` and wait for user
2. **Auto-reconciliation** - user must manually verify
3. **Tool-specific reconciliation methods** - deferred

---

## References

- `specs/exec-00-overview.md` - Overview and implementation order
- `specs/exec-09-run-status-separation.md` - Status separation spec
- `specs/exec-10-retry-chain.md` - Retry chain spec
- `specs/exec-11-scheduler-state.md` - Scheduler state and wakeAt spec
- `specs/exec-12-failure-classification.md` - Failure classification spec
- `specs/exec-13-producer-scheduling.md` - Per-producer scheduling spec
- `specs/exec-14-indeterminate-mutations.md` - Indeterminate mutation handling spec
- `docs/dev/06-execution-model.md`
- `docs/dev/06a-topics-and-handlers.md`
- `docs/dev/06b-consumer-lifecycle.md`
- `docs/dev/09-failure-repair.md`
- `docs/dev/15-host-policies.md`
- `docs/dev/16-scheduling.md`
