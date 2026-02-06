# Keep.AI v1 Implementation Plan

## Status: Looking for Next Spec

**exec-15 (Input Ledger, Causal Tracking, Topic Declarations) is complete!**

All 8 phases have been implemented and tested with 123 new tests passing.

---

## Recently Completed

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

Based on the spec referenced in exec-15 as "UX-layer concerns for a separate spec (Chapter 17)":

### Potential: exec-16 - Inputs & Outputs UX

**Reference:** [`docs/dev/17-inputs-outputs.md`](docs/dev/17-inputs-outputs.md)

This spec would implement:
- Input Ledger UX (Inputs & Outputs view, skip semantics, pending rollup)
- Output/mutation ledger UX
- Stale input warnings
- Input status computation queries for the UI

This builds on the data model created in exec-15 (Input Ledger, caused_by tracking, ui_title).

---

## Current Database Version: 44

**Latest Tag:** v1.0.0-alpha.124
