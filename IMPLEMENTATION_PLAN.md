# Keep.AI v1 Implementation Plan

## Status: Codebase clean, no pending specs

All specs completed and in `specs/done/`. Ideas from `ideas/` folder verified as already implemented.

---

## Codebase Architecture Summary

### Execution Model (discovered during analysis)

**Dual Execution Paths:**
1. **Legacy**: Direct script execution via `WorkflowWorker.executeWorkflow()`
2. **New (exec-07)**: Session-based execution via `session-orchestration.ts`

**Key Components:**
- `WorkflowScheduler` - 10s interval loop, cron-based scheduling, retry management
- `TaskScheduler` - Inbox-driven agent task execution
- `handler-state-machine.ts` - Consumer three-phase model (prepare/mutate/next)
- `MutationStore` - Mutation ledger with status tracking
- `ReconciliationScheduler` - Background reconciliation for uncertain mutations

**Scheduler Runtime Notes:**
- Producer schedules stored in `producer_schedules` table (v43 migration)
- Consumer wakeAt stored in `handler_state` table (v42 migration)
- Reconciliation scheduler processes `needs_reconcile` mutations with exponential backoff

---

## Recently Completed

### TypeScript Fix - script-store.test.ts ✅

Fixed 17 workflow test objects missing `intent_spec` property (added in exec-17). Discovered during type-check, all tests now pass.

### exec-19 - Consumer wakeAt Scheduling Integration ✅

**Spec Reference:** `docs/dev/16-scheduling.md` §Consumer Scheduling

**Why Critical:** Per docs/dev/16-scheduling.md, time-based patterns (daily digests, delayed processing, batch timeouts) require the host to wake consumers at scheduled times, not just on new events. Without wakeAt integration, consumers could only be triggered by events, making time-based workflows impossible.

**Implementation Summary:**
- Phase 1: Fixed TypeScript build error in ReconciliationScheduler (NodeJS.Timer → ReturnType<typeof setInterval>)
- Phase 2: Updated `findConsumerWithPendingWork()` in session-orchestration.ts to check for due wakeAt
- Phase 3: Added 5 comprehensive tests for wakeAt scheduling behavior

**Key Features:**
- Events take priority over wakeAt (if both are present, events trigger first)
- wakeAt only triggers consumers defined in handler_config
- wakeAt=0 means no scheduled wake
- Existing infrastructure (v42 migration, handlerStateStore.getConsumersWithDueWakeAt) now integrated into scheduler
- wakeAt is cleared when PrepareResult doesn't include it (already implemented in handler-state-machine.ts)

**Files Modified:**
- `packages/agent/src/session-orchestration.ts` - Added wakeAt check to findConsumerWithPendingWork
- `packages/agent/src/reconciliation/scheduler.ts` - Fixed TypeScript type error
- `packages/tests/src/session-orchestration.test.ts` - Added 5 new tests, updated schema

**Test Coverage:** 5 new tests covering:
- Consumer not triggered when wakeAt is in the future
- Consumer triggered when wakeAt is due
- Events prioritized over wakeAt
- wakeAt ignored for consumers not in config
- wakeAt=0 means no scheduled wake

### exec-18 - Mutation Reconciliation Runtime ✅

**Spec File:** [`specs/done/exec-18-mutation-reconciliation-runtime.md`](specs/done/exec-18-mutation-reconciliation-runtime.md)

**Why Critical:** Per `docs/dev/13-reconciliation.md`, mutation reconciliation is "the foundation for idempotent execution guarantees." Without it, the system cannot recover from transient failures (timeouts, network issues, crashes during external calls).

**Implementation Summary:**
- Phase 1: Connector reconcile interface - ReconcileResult, MutationParams, ReconcilableTool types
- Phase 2: Gmail connector reconcile - Search sent folder by idempotency key
- Phase 3: Mutation wrapper updates - handleUncertainOutcome in handler-state-machine
- Phase 4: Background reconciliation job - ReconciliationScheduler with exponential backoff
- Phase 5: MutationStore extensions - markNeedsReconcile, getDueForReconciliation, scheduleNextReconcile
- Phase 6: Handler state machine integration - needs_reconcile status handling
- Phase 7: Tests - 19 new tests for reconciliation functionality

**Key Features:**
- ReconciliationRegistry singleton for tool reconcile method registration
- Immediate reconciliation on uncertain outcomes (timeout/network errors)
- Background reconciliation with configurable policy (max attempts, backoff)
- ReconciliationScheduler with 10s default check interval
- Exhausted reconciliation → indeterminate status → workflow paused
- Gmail send reconciliation via sent folder search

**Files Created:**
- `packages/agent/src/reconciliation/types.ts`
- `packages/agent/src/reconciliation/registry.ts`
- `packages/agent/src/reconciliation/gmail-reconcile.ts`
- `packages/agent/src/reconciliation/scheduler.ts`
- `packages/agent/src/reconciliation/index.ts`
- `packages/tests/src/reconciliation.test.ts`

**Files Modified:**
- `packages/db/src/mutation-store.ts` - Added reconciliation methods
- `packages/agent/src/handler-state-machine.ts` - Immediate reconciliation integration
- `packages/agent/src/index.ts` - Export reconciliation module

### exec-17 - Intent Contract ✅

**Spec File:** [`specs/done/exec-17-intent-contract.md`](specs/done/exec-17-intent-contract.md)

**Implementation Summary:**
- Phase 1: Database migration (v45) - Added intent_spec column to workflows table
- Phase 2: Intent extraction prompt - Created focused LLM prompt with JSON schema response format
- Phase 3: Hook extraction to planner save - Triggers on first major version save, fire-and-forget async
- Phase 4: UI - Intent section on workflow detail page (WorkflowIntentSection component)
- Phase 5: Maintainer prompt update - Include intent spec in maintainer context
- Phase 6: Tests (17 new tests for intent functionality)

**Key Features:**
- Structured IntentSpec with goal, inputs, outputs, assumptions, nonGoals, semanticConstraints, title
- LLM-based intent extraction from user messages via OpenRouter API
- Intent spec stored at workflow level (not per-script)
- Maintainer agent receives intent context for repair decisions
- React component for displaying structured intent in workflow detail page
- parseIntentSpec and formatIntentForPrompt utility functions

**Note:** Phases 7 (Backfill UI), 8 (API endpoint) were deferred as core functionality is complete.

### exec-16 - Inputs & Outputs UX ✅

**Spec File:** [`specs/done/exec-16-inputs-outputs-ux.md`](specs/done/exec-16-inputs-outputs-ux.md)

**Implementation Summary:**
- Phase 1: Database query methods and React hooks (InputStore, EventStore, MutationStore extensions)
- Phase 2: Dashboard Inputs Summary component (WorkflowInputsSummary)
- Phase 3: Inputs List view with status computation (WorkflowInputsPage)
- Phase 4: Input Detail view with mutation tracing (InputDetailPage)
- Phase 6: Outputs view (WorkflowOutputsPage)
- Phase 8: Comprehensive test suite (16 new tests)

**Key Features:**
- Input status computation (pending/done/skipped based on event state)
- Input statistics aggregation by source/type
- Stale input detection (pending longer than threshold)
- Output statistics by connector
- Causal tracing from inputs to mutations
- Full React Query hooks for all data access

**Note:** Phase 5 (Skip Input functionality) and Phase 7 (UI polish) were deferred as the core functionality is complete.

### exec-15 - Input Ledger, Causal Tracking, and Topic Declarations ✅

**Spec File:** [`specs/done/exec-15-input-ledger-and-causal-tracking.md`](specs/done/exec-15-input-ledger-and-causal-tracking.md)

**Implementation Summary:**
- Phase 1 & 2: Database foundation (v44 migration, InputStore)
- Phase 3: Topics API updates (registerInput, multi-topic, inputId/causedBy)
- Phase 4: WorkflowConfig with publishes declarations
- Phase 5: Handler context threading
- Phase 6: PrepareResult.ui and mutation UI title
- Phase 7: Prompt updates
- Phase 8: Comprehensive test suite (123 new tests)

---

## What's Available for Next Implementation

Review available specs in `specs/` directory, `docs/dev/` for design docs, and `docs/ISSUES.md` for prioritized feature requests.

---

## Current Database Version: 45

**Latest Tag:** v1.0.0-alpha.126

