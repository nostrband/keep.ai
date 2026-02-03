# Keep.AI Implementation Plan

This document tracks the implementation status of the new execution model refactor (exec-00 through exec-08) and other pending work items.

**Last Updated:** 2026-02-03
**Current Database Version:** v38
**Overall Progress:** 9/9 core specs implemented

---

## Executive Summary

> **COMPLETE** - The execution model refactor (exec-00 through exec-09) is fully implemented. Tagged as `v1.0.0-alpha.99`.

The codebase has transitioned from an **Items-based execution model** (`Items.withItem()`) to a **Topics-based event-driven model** with structured producers/consumers and three-phase execution. This major architectural refactor affects the agent, database, and workflow execution systems.

**Verification Status (2026-02-03):**
- All tests pass: 875 tests total, 55 appropriately skipped
- Build is clean with no errors
- Codebase is stable at v1.0.0-alpha.99

**Final State:**
- All 9 core specs (exec-01 through exec-09) implemented and tested
- Old Items infrastructure deprecated and removed
- ToolWrapper active with phase tracking; SandboxAPI deprecated
- Session orchestration integrated into WorkflowScheduler

---

## Implementation Priority

### Phase A: Infrastructure (Parallel)

- [x] **[P1] exec-01: Database Schema** - [specs/exec-01-database-schema.md](specs/exec-01-database-schema.md)
  - Migration v36.ts with tables: `topics`, `events`, `handler_runs`, `mutations`, `handler_state`
  - Store classes: TopicStore, EventStore, HandlerRunStore, MutationStore, HandlerStateStore
  - **Status:** COMPLETE

- [x] **[P1] exec-02: Deprecate Items** - [specs/exec-02-deprecate-items.md](specs/exec-02-deprecate-items.md)
  - Removed Items.withItem() from SandboxAPI and ToolWrapper
  - Deprecated ItemStore (kept for data preservation)
  - **Status:** COMPLETE
  - **Note:** Breaking change - existing workflows using Items.withItem() need re-planning.

### Phase B: Sandbox Changes (Sequential)

- [x] **[P2] exec-03: Topics API** - [specs/exec-03-topics-api.md](specs/exec-03-topics-api.md)
  - Topics.peek(), Topics.getByIds(), Topics.publish() in `packages/agent/src/tools/topics.ts`
  - Topics namespace exposed in sandbox (globalThis.Topics)
  - **Status:** COMPLETE

- [x] **[P2] exec-03a: Complete Tool Migration** - [specs/exec-03a-complete-tool-migration.md](specs/exec-03a-complete-tool-migration.md)
  - `packages/agent/src/sandbox/tool-lists.ts` with createWorkflowTools(), createTaskTools()
  - Phase tracking added to ToolWrapper; WorkflowWorker and TaskWorker migrated
  - SandboxAPI deprecated (kept for backwards compatibility)
  - **Status:** COMPLETE

- [x] **[P2] exec-04: Phase Tracking** - [specs/exec-04-phase-tracking.md](specs/exec-04-phase-tracking.md)
  - Phase state management in ToolWrapper (currentPhase, mutationExecuted, currentMutation)
  - Phase restriction matrix enforcement implemented
  - **Status:** COMPLETE

- [x] **[P3] exec-05: Script Validation** - [specs/exec-05-script-validation.md](specs/exec-05-script-validation.md)
  - `packages/agent/src/workflow-validator.ts` with validateWorkflowScript() and zero-tool sandbox
  - handler_config field added to Workflow; validation integrated into save and fix tools
  - **Status:** COMPLETE

### Phase C: Execution Engine (Sequential)

- [x] **[P3] exec-06: Handler State Machine** - [specs/exec-06-handler-state-machine.md](specs/exec-06-handler-state-machine.md)
  - `packages/agent/src/handler-state-machine.ts` with executeHandler() function
  - Producer phases: pending -> executing -> committed|failed
  - Consumer phases: pending -> preparing -> prepared -> mutating -> mutated -> emitting -> committed
  - Crash recovery with checkpoint-based resume
  - **Status:** COMPLETE

- [x] **[P3] exec-07: Session Orchestration** - [specs/exec-07-session-orchestration.md](specs/exec-07-session-orchestration.md)
  - `packages/agent/src/session-orchestration.ts` with executeWorkflowSession() function
  - Session container using script_runs with trigger types (schedule, webhook, manual)
  - Producer execution followed by consumer loop (max 100 iterations)
  - Recovery functions: resumeIncompleteSessions(), continueSession()
  - **Status:** COMPLETE

### Phase D: LLM Integration

- [x] **[P4] exec-08: Planner Prompts** - [specs/exec-08-planner-prompts.md](specs/exec-08-planner-prompts.md)
  - Updated PLANNER_SYSTEM_PROMPT: removed "Logical Items", added "Workflow Structure", "Phase Rules", "Event Design"
  - Updated MAINTAINER_SYSTEM_PROMPT: removed "Logical Item Constraints", added "Workflow Constraints"
  - **Status:** COMPLETE

- [x] **[P4] exec-09: Scheduler Integration** - [No spec file - integration work]
  - Integrated executeWorkflowSession into WorkflowScheduler
  - Added resumeIncompleteSessions() call on start()
  - New format detection via isNewFormatWorkflow() based on handler_config
  - **Status:** COMPLETE

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
                      exec-08 (Planner Prompts) ✓                │
                                                                 │
                      exec-06 (Handler State Machine) ✓ ◄────────┘
                             │
                             ▼
                      exec-07 (Session Orchestration) ✓
                             │
                             ▼
                      exec-09 (Scheduler Integration) ✓
```

---

## Technical Debt & Code Quality

### Deprecated Code to Remove (After Migration)

- [x] Gmail-specific API endpoints in apps/server/src/server.ts - REMOVED
  - Removed deprecated Gmail-specific endpoints (/api/gmail/status, /api/gmail/connect, /api/gmail/callback, /api/gmail/check)
  - Generic connector endpoints at /api/connectors/* are now the only supported approach
- [x] `chat_events` table - REMOVED via migration v38
- [x] `task_states` table - REMOVED via migration v37
- [x] `resources` table - REMOVED via migration v37
- [x] `chat_notifications` table - REMOVED via migration v37
- [x] AuthDialog component - REMOVED (was already just a re-export, now deleted)
- [x] Deprecated task tools in packages/agent/src/tools/deprecated/ - REMOVED (directory deleted)
- [ ] Task fields: `task`, `cron` (deprecated per Spec 10)

**Note:** Migration v37 was created to drop the deprecated tables (`resources`, `task_states`, `chat_notifications`).

**Note:** Migration v38 removed the `chat_events` table and the following deprecated ChatStore methods were removed: `getChatMessages`, `getChatEvents`, `saveChatMessages`, `saveChatEvent`, `countMessages`, `getLastChatActivity`, `getLastChatActivities`, `getChatFirstMessage`.

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

For exec-01 (Database stores):
- [x] packages/tests/src/topic-store.test.ts - ✓ DONE (19 tests)
- [x] packages/tests/src/event-store.test.ts - ✓ DONE (30 tests)
- [x] packages/tests/src/handler-run-store.test.ts - ✓ DONE (26 tests)
- [x] packages/tests/src/mutation-store.test.ts - ✓ DONE (28 tests)
- [x] packages/tests/src/handler-state-store.test.ts - ✓ DONE (21 tests)

For exec-03:
- [x] packages/tests/src/topics-api.test.ts - ✓ DONE (29 tests)

For exec-04:
- [x] packages/tests/src/phase-tracking.test.ts - ✓ DONE (48 tests)

For exec-06:
- [x] packages/tests/src/handler-state-machine.test.ts - ✓ DONE (28 tests)

For exec-07:
- [x] packages/tests/src/session-orchestration.test.ts - ✓ DONE (25 tests)

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
packages/agent/src/handler-state-machine.ts # ✓ DONE - executeHandler function
packages/agent/src/session-orchestration.ts # ✓ DONE - executeWorkflowSession function
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
packages/agent/src/index.ts                # ✓ DONE - Exports ToolWrapper, tool-lists, ExecutionPhase, OperationType, executeHandler, session orchestration
packages/db/src/script-store.ts            # ✓ DONE - Added handler_config field, updateWorkflowFields support, incrementHandlerCount method
packages/agent/src/agent-env.ts            # ✓ DONE - Updated planner/maintainer prompts for workflow format
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
