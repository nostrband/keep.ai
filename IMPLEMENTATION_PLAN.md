# Keep.AI v1 Implementation Plan

## Status: Ready for Next Spec

**exec-17 (Intent Contract) implementation complete.**

---

## Recently Completed

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

**Latest Tag:** v1.0.0-alpha.124
