# Keep.AI Implementation Plan

This document tracks the implementation status of the new execution model refactor (exec-00 through exec-08) and other pending work items.

**Last Updated:** 2026-02-03
**Current Database Version:** v36
**Overall Progress:** 6/8 core specs implemented

---

## Executive Summary

The codebase is transitioning from an **Items-based execution model** (`Items.withItem()`) to a **Topics-based event-driven model** with structured producers/consumers and three-phase execution. This is a major architectural refactor affecting the agent, database, and workflow execution systems.

**Current State:**
- Old Items infrastructure is **deprecated and removed**
- New Topics infrastructure: **exec-01 (Database Schema) COMPLETE**, **exec-03 (Topics API) COMPLETE**
- Deprecation: **exec-02 (Deprecate Items) COMPLETE**
- Tool migration: **exec-03a (Complete Tool Migration) COMPLETE**
- Remaining specs (04-08) require sequential implementation
- ToolWrapper is now **active** with phase tracking - SandboxAPI is deprecated

---

## Implementation Priority

### Phase A: Infrastructure (Parallel)

- [x] **[P1] exec-01: Database Schema** - [specs/exec-01-database-schema.md](specs/exec-01-database-schema.md)
  - Create migration v36.ts with new tables
  - Tables needed: `topics`, `events`, `handler_runs`, `mutations`, `handler_state`
  - Extend: `script_runs` (trigger, handler_run_count), `workflows` (handler_config, consumer_sleep_until)
  - Create store classes: TopicStore, EventStore, HandlerRunStore, MutationStore, HandlerStateStore
  - **Status:** COMPLETE - 100%
  - **Implementation:**
    - `packages/db/src/migrations/v36.ts` - All tables and schema extensions
    - `packages/db/src/topic-store.ts` - TopicStore with CRUD, getOrCreate
    - `packages/db/src/event-store.ts` - EventStore with peek, publish, reserve, consume, skip, release
    - `packages/db/src/handler-run-store.ts` - HandlerRunStore with phase transitions, incomplete run queries
    - `packages/db/src/mutation-store.ts` - MutationStore with status transitions, reconciliation tracking
    - `packages/db/src/handler-state-store.ts` - HandlerStateStore with get/set per handler
    - All stores exported in `index.ts` and registered in `api.ts`
  - **Dependencies:** None
  - **Blocked by:** Nothing

- [x] **[P1] exec-02: Deprecate Items** - [specs/exec-02-deprecate-items.md](specs/exec-02-deprecate-items.md)
  - Remove Items.withItem() from SandboxAPI and ToolWrapper
  - Remove Items.list tool (packages/agent/src/tools/items-list.ts)
  - Remove activeItem/activeItemIsDone tracking
  - Remove enforceMutationRestrictions() method
  - Update prompts to remove "Logical Items" sections
  - Deprecate ItemStore (keep for data preservation)
  - Skip/remove logical-items.test.ts
  - **Status:** COMPLETE - 100%
  - **Implementation:**
    - Removed `Items.withItem()` from SandboxAPI (`packages/agent/src/sandbox/api.ts`, lines 504-627)
    - Removed `Items.withItem()` from ToolWrapper (`packages/agent/src/sandbox/tool-wrapper.ts`, lines 142-383)
    - Removed `enforceMutationRestrictions()` method from both SandboxAPI and ToolWrapper
    - Removed `activeItem` and `activeItemIsDone` tracking from both classes
    - Removed Items.list tool export from `packages/agent/src/tools/index.ts`
    - Deprecated ItemStore class and related types with @deprecated JSDoc in `packages/db/src/item-store.ts`
    - Deprecated `packages/agent/src/tools/items-list.ts` tool file with @deprecated JSDoc
    - Skipped tests for Items.list Tool and Mutation Enforcement in `packages/tests/src/logical-items.test.ts`
  - **Dependencies:** None
  - **Blocked by:** Nothing
  - **Note:** Breaking change - existing workflows using Items.withItem() will need re-planning. Prompts still contain "Logical Items" documentation (to be removed in exec-08).

### Phase B: Sandbox Changes (Sequential)

- [x] **[P2] exec-03: Topics API** - [specs/exec-03-topics-api.md](specs/exec-03-topics-api.md)
  - Create packages/agent/src/tools/topics.ts
  - Implement Topics.peek(), Topics.getByIds(), Topics.publish()
  - Expose Topics namespace in sandbox (globalThis.Topics)
  - **Status:** COMPLETE - 100%
  - **Implementation:**
    - Created `packages/agent/src/tools/topics.ts` with Topics.peek, Topics.getByIds, Topics.publish tools
    - Exported Topics tools from `packages/agent/src/tools/index.ts`
    - Added Topics namespace to SandboxAPI.createGlobal() in `packages/agent/src/sandbox/api.ts`
    - Tools use EventStore from exec-01 for all operations
    - Phase restrictions documented (to be enforced by exec-06 handler state machine)
  - **Dependencies:** exec-01 (database schema) ✓ DONE
  - **Blocked by:** Nothing (exec-01 is complete)
  - **Note:** Phase enforcement is not yet implemented - will be added in exec-04 and exec-06.

- [x] **[P2] exec-03a: Complete Tool Migration** - [specs/exec-03a-complete-tool-migration.md](specs/exec-03a-complete-tool-migration.md)
  - Create packages/agent/src/sandbox/tool-lists.ts with createWorkflowTools(), createTaskTools()
  - Add phase tracking to ToolWrapper (setPhase, getPhase, checkPhaseAllowed)
  - Remove Items.withItem from ToolWrapper
  - Migrate WorkflowWorker and TaskWorker to use ToolWrapper
  - Deprecate api.ts (keep for backwards compatibility)
  - **Status:** COMPLETE - 100%
  - **Implementation:**
    - Created `packages/agent/src/sandbox/tool-lists.ts` with `createWorkflowTools()` and `createTaskTools()` functions
    - Added phase tracking to ToolWrapper: `setPhase()`, `getPhase()`, `checkPhaseAllowed()` methods
    - Added `ExecutionPhase` and `OperationType` types to ToolWrapper
    - Updated WorkflowWorker to use ToolWrapper + createWorkflowTools
    - Updated TaskWorker to use ToolWrapper + createTaskTools
    - Added exports in `packages/agent/src/index.ts` for ToolWrapper, tool-lists, ExecutionPhase, OperationType
    - SandboxAPI (`api.ts`) deprecated with @deprecated JSDoc (kept for backwards compatibility)
  - **Dependencies:** exec-02 ✓ DONE, exec-03 ✓ DONE
  - **Blocked by:** Nothing

- [x] **[P2] exec-04: Phase Tracking** - [specs/exec-04-phase-tracking.md](specs/exec-04-phase-tracking.md)
  - Add phase state management to ToolWrapper (currentPhase, mutationExecuted, currentMutation)
  - Implement phase restriction matrix enforcement
  - Add global variable injection (__state__, __prepared__, __mutationResult__)
  - Remove deprecated activeItem-based enforcement
  - **Status:** COMPLETE - 100%
  - **Current State:** ToolWrapper has full phase tracking with currentMutation support for the mutate phase.
  - **Implementation:**
    - Added `currentMutation: Mutation | null` tracking to ToolWrapper
    - Added `setCurrentMutation()` method to set the mutation record for mutate phase
    - Added `getCurrentMutation()` method for mutation tools to access the record
    - Updated `setPhase()` to reset `currentMutation` when phase changes
    - Phase restriction matrix and enforcement already existed from exec-03a
    - Global variable injection (`__state__`, `__prepared__`, `__mutationResult__`) will be done by handler state machine (exec-06)
  - **Files Modified:** `packages/agent/src/sandbox/tool-wrapper.ts` ✓ DONE
  - **Dependencies:** exec-03a ✓ DONE
  - **Blocked by:** Nothing

- [x] **[P3] exec-05: Script Validation** - [specs/exec-05-script-validation.md](specs/exec-05-script-validation.md)
  - Create packages/agent/src/workflow-validator.ts
  - Implement validateWorkflowScript() with zero-tool sandbox
  - Extract WorkflowConfig from validated scripts
  - Add WorkflowStore.updateHandlerConfig() method
  - Integrate validation into save tool and fix tool
  - **Status:** COMPLETE - 100%
  - **Current State:** Workflow validation is fully implemented with zero-tool sandbox validation and handler_config persistence.
  - **Implementation:**
    - Created `packages/agent/src/workflow-validator.ts` with `validateWorkflowScript()` and `isWorkflowFormatScript()` functions
    - Created zero-tool validation sandbox that throws errors for all tool calls
    - Added `handler_config: string` field to Workflow interface in `packages/db/src/script-store.ts`
    - Extended `updateWorkflowFields()` to support `handler_config` field
    - Updated all workflow getters (getWorkflow, getWorkflowByTaskId, getWorkflowByChatId, listWorkflows) to include handler_config
    - Integrated validation into save tool (`packages/agent/src/ai-tools/save.ts`) - validates on save and stores config
    - Integrated validation into fix tool (`packages/agent/src/ai-tools/fix.ts`) - validates on fix and stores config
    - Exported WorkflowConfig and ValidationResult types from agent package
    - Updated test files to include handler_config column in table creation
  - **Dependencies:** exec-04 ✓ DONE
  - **Blocked by:** Nothing

### Phase C: Execution Engine (Sequential)

- [ ] **[P3] exec-06: Handler State Machine** - [specs/exec-06-handler-state-machine.md](specs/exec-06-handler-state-machine.md)
  - Implement unified executeHandler() function
  - Producer state machine: pending → executing → committed|failed
  - Consumer state machine: pending → preparing → prepared → mutating → mutated → emitting → committed
  - Mutation handling with status tracking (pending, in_flight, applied, failed, indeterminate)
  - Crash recovery with checkpoint-based resume
  - Helper functions: failRun, suspendRun, savePrepareAndReserve, commitProducer, commitConsumer
  - **Status:** NOT STARTED - 0% complete
  - **Current State:** No handler-state-machine.ts file. No executeHandler function. WorkflowWorker has simple try/catch execution, not a state machine.
  - **Dependencies:** exec-01 ✓ DONE, exec-04
  - **Blocked by:** exec-04

- [ ] **[P3] exec-07: Session Orchestration** - [specs/exec-07-session-orchestration.md](specs/exec-07-session-orchestration.md)
  - Implement executeWorkflowSession() orchestration function
  - Session container using script_runs with trigger types
  - Producer execution followed by consumer loop (max 100 iterations)
  - findConsumerWithPendingWork() for work detection
  - Session state functions: completeSession, failSession, suspendSession
  - Recovery: resumeIncompleteSessions (app startup), continueSession
  - Cost aggregation from handler runs
  - **Status:** NOT STARTED - 0% complete
  - **Current State:** No session-orchestration.ts file. WorkflowWorker.executeWorkflow() runs single scripts, not producer+consumer sessions.
  - **Dependencies:** exec-06
  - **Blocked by:** exec-06

### Phase D: LLM Integration

- [ ] **[P4] exec-08: Planner Prompts** - [specs/exec-08-planner-prompts.md](specs/exec-08-planner-prompts.md)
  - Update PLANNER_SYSTEM_PROMPT:
    - Remove "Logical Items" section and Items.withItem() examples
    - Add "Workflow Structure" section (topics, producers, consumers)
    - Add "Phase Rules" section
    - Add "Event Design" section (messageId, title guidelines)
  - Update MAINTAINER_SYSTEM_PROMPT:
    - Remove "Logical Item Constraints" section
    - Add "Workflow Constraints" section
  - Location: packages/agent/src/agent-env.ts
  - **Status:** NOT STARTED - 0% complete
  - **Current State:** Prompts still contain full "Logical Items" documentation:
    - PLANNER_SYSTEM_PROMPT has "Logical Items" section (lines 463-521)
    - PLANNER_SYSTEM_PROMPT has "Logical Items Rules" (lines 523-529)
    - MAINTAINER_SYSTEM_PROMPT has "Logical Item Constraints" (lines 623-643)
    - No mention of topics, producers, consumers, or phases
  - **Dependencies:** exec-05
  - **Blocked by:** exec-05

---

## Dependency Graph

```
exec-01 (DB Schema) ✓ ───────┬──────────────────────────────────┐
                             │                                   │
exec-02 (Deprecate Items) ✓ ─┼──────────┐                        │
                             │          │                        │
                             ▼          │                        │
                      exec-03 (Topics) ✓│                        │
                             │          │                        │
                             ▼          ▼                        │
                      exec-03a (Tool Migration) ✓                │
                             │                                   │
                             ▼                                   │
                      exec-04 (Phase Tracking) ✓ ─────────────────┤
                             │                                   │
                             ▼                                   │
                      exec-05 (Script Validation) ✓              │
                             │                                   │
                             ▼                                   │
                      exec-08 (Planner Prompts)                  │
                                                                 │
                      exec-06 (Handler State Machine) ◄──────────┘
                             │
                             ▼
                      exec-07 (Session Orchestration)
```

---

## Technical Debt & Code Quality

### Deprecated Code to Remove (After Migration)

- [ ] Gmail-specific API endpoints in apps/server/src/server.ts (lines 1209-1581)
  - Use generic connector endpoints instead
- [ ] `chat_events` table (replaced by chat_messages, notifications, execution_logs)
- [ ] `task_states` table (no longer used)
- [ ] `resources` table (never implemented)
- [ ] `chat_notifications` table (per Spec 07)
- [ ] AuthDialog component (use AuthPopup)
- [ ] Deprecated task tools in packages/agent/src/tools/deprecated/
- [ ] Task fields: `task`, `cron` (deprecated per Spec 10)

### FIXME Comments Requiring Attention

- [ ] packages/sync/src/Peer.ts:788 - Transaction delivery reliability for change batches
- [ ] packages/sync/src/nostr/stream/StreamWriter.ts:515 - Bandwidth threshold tuning

### @ts-ignore Suppressions to Fix

- apps/server/src/server.ts: lines 863, 2014
- apps/web/src/db.ts: line 2
- packages/agent/src/agent.ts: lines 277, 336, 359
- packages/browser/src/startWorker.ts: line 74

### Skipped Tests to Re-enable

- [ ] exec-many-args-browser.test.ts - Entire suite (browser environment)
- [ ] crsqlite-peer-new.test.ts - Synchronization tests
- [ ] file-transfer.test.ts - Real encryption test
- [ ] nostr-transport.test.ts - Connection tests (WebSocket)
- [ ] compression.test.ts - Error handling tests
- [ ] nostr-transport-sync.test.ts - Synchronization suite

---

## Testing Requirements

### New Test Files Needed

For exec-01 (Database stores - implementation verified via build+tests passing):
- [ ] packages/tests/src/topic-store.test.ts (optional - basic CRUD works)
- [ ] packages/tests/src/event-store.test.ts (optional - methods used by Topics API)
- [ ] packages/tests/src/handler-run-store.test.ts (optional - methods work)
- [ ] packages/tests/src/mutation-store.test.ts (optional - methods work)
- [ ] packages/tests/src/handler-state-store.test.ts (optional - methods work)

For exec-03:
- [ ] packages/tests/src/topics-api.test.ts

For exec-04:
- [ ] packages/tests/src/phase-tracking.test.ts

For exec-06:
- [ ] packages/tests/src/handler-state-machine.test.ts

For exec-07:
- [ ] packages/tests/src/session-orchestration.test.ts

---

## Files to Create

```
packages/db/src/migrations/v36.ts          # ✓ DONE - New database schema
packages/db/src/topic-store.ts             # ✓ DONE - Topic CRUD operations
packages/db/src/event-store.ts             # ✓ DONE - Event CRUD + status transitions
packages/db/src/handler-run-store.ts       # ✓ DONE - Handler run tracking
packages/db/src/mutation-store.ts          # ✓ DONE - Mutation ledger
packages/db/src/handler-state-store.ts     # ✓ DONE - Persistent handler state
packages/agent/src/tools/topics.ts         # ✓ DONE - Topics.peek, getByIds, publish
packages/agent/src/sandbox/tool-lists.ts   # ✓ DONE - createWorkflowTools, createTaskTools
packages/agent/src/workflow-validator.ts   # ✓ DONE - Script structure validation
packages/agent/src/handler-state-machine.ts # executeHandler function
packages/agent/src/session-orchestration.ts # executeWorkflowSession function
```

## Files to Modify

```
packages/db/src/database.ts                # ✓ DONE - Register v36 migration
packages/db/src/index.ts                   # ✓ DONE - Export new stores
packages/db/src/api.ts                     # ✓ DONE - Add new stores to KeepDbApi
packages/db/src/item-store.ts              # ✓ DONE - Deprecated with @deprecated JSDoc
packages/agent/src/tools/items-list.ts     # ✓ DONE - Deprecated with @deprecated JSDoc
packages/agent/src/sandbox/api.ts          # ✓ DONE - Removed Items.withItem, added Topics, deprecated
packages/agent/src/sandbox/tool-wrapper.ts # ✓ DONE - Removed Items.withItem, added phase tracking (setPhase, getPhase, checkPhaseAllowed), added currentMutation tracking (setCurrentMutation, getCurrentMutation)
packages/agent/src/tools/index.ts          # ✓ DONE - Removed items-list, added topics
packages/agent/src/workflow-worker.ts      # ✓ DONE - Uses ToolWrapper + createWorkflowTools
packages/agent/src/task-worker.ts          # ✓ DONE - Uses ToolWrapper + createTaskTools
packages/agent/src/index.ts                # ✓ DONE - Exports ToolWrapper, tool-lists, ExecutionPhase, OperationType
packages/db/src/script-store.ts            # ✓ DONE - Added handler_config field, updateWorkflowFields support
packages/agent/src/agent-env.ts            # Update planner/maintainer prompts
packages/agent/src/ai-tools/save.ts        # ✓ DONE - Integrated validation
packages/agent/src/ai-tools/fix.ts         # ✓ DONE - Integrated validation
```

---

## Risk Assessment

**High Risk:**
- Breaking change for existing workflows using Items.withItem() - **COMPLETED in exec-02**
- All existing workflows will need to be re-planned after migration
- Users should be warned before deployment

**Medium Risk:**
- Complex state machine logic in exec-06 requires thorough testing
- Crash recovery scenarios need extensive testing
- Mutation indeterminate state handling requires careful UX design

**Low Risk:**
- Database schema changes are additive (except deprecating items)
- Old api.ts kept for backwards compatibility during transition
- Prompt changes can be rolled back if needed

---

## Notes

- All new database tables should use `crsql_as_crr()` for conflict-free replication
- Phase enforcement should throw LogicError for violations (not crash)
- Mutation record must be created BEFORE external call for crash detection
- Session budget limit (100 iterations) prevents infinite loops
- Producer schedules support both interval and cron formats
