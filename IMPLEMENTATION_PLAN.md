# Keep.AI v1 Implementation Plan

## Active Spec: exec-15 - Input Ledger, Causal Tracking, and Topic Declarations

**Spec File:** [`specs/new/exec-15-input-ledger-and-causal-tracking.md`](specs/new/exec-15-input-ledger-and-causal-tracking.md)

---

## Implementation Checklist

Items are ordered by dependencies - earlier items must be completed before later ones.

### Phase 1: Database Foundation (Must Complete First) ✅

- [x] **1.1 Create migration v44** - Create `inputs` table, add `caused_by` to events, add `ui_title` to mutations
  - File: `packages/db/src/migrations/v44.ts`
  - Details:
    - Create `inputs` table with columns: `id`, `workflow_id`, `source`, `type`, `external_id`, `title`, `created_by_run_id`, `created_at`
    - Add unique constraint: `(workflow_id, source, type, external_id)`
    - Add index: `idx_inputs_workflow`
    - Register as CRR: `SELECT crsql_as_crr('inputs')`
    - Add `caused_by TEXT NOT NULL DEFAULT '[]'` to events table
    - Add `ui_title TEXT` to mutations table

- [x] **1.2 Update database.ts to run v44 migration**
  - File: `packages/db/src/database.ts`
  - Dependencies: 1.1

### Phase 2: Data Access Layer ✅

- [x] **2.1 Create InputStore class**
  - File: Create `packages/db/src/input-store.ts`
  - Dependencies: 1.1
  - Details:
    - `Input` interface with all columns
    - `RegisterInputParams` interface: `{ source, type, id, title }`
    - `register(workflowId, params, createdByRunId)` - idempotent by unique constraint
    - `get(inputId)`
    - `getByWorkflow(workflowId)`

- [x] **2.2 Add InputStore to KeepDbApi**
  - File: `packages/db/src/api.ts`
  - Dependencies: 2.1
  - Details: Add `inputStore: InputStore` property and initialization

- [x] **2.3 Export InputStore from db package**
  - File: `packages/db/src/index.ts`
  - Dependencies: 2.1

- [x] **2.4 Update EventStore.publishEvent to accept causedBy**
  - File: `packages/db/src/event-store.ts`
  - Dependencies: 1.1
  - Details:
    - Add `causedBy?: string[]` to `PublishEvent` interface
    - Update `publishEvent()` to store `JSON.stringify(causedBy || [])` in `caused_by` column
    - Set `title = ''` for new events (backward compat: keep column, just don't populate)
    - On conflict (idempotent re-publish), also update `caused_by`

- [x] **2.5 Add getCausedByForRun method to EventStore**
  - File: `packages/db/src/event-store.ts`
  - Dependencies: 1.1
  - Details:
    - Query events where `reserved_by_run_id = ?`
    - Union all `caused_by` arrays into deduplicated set
    - Return `string[]`

- [x] **2.6 Update MutationStore to support ui_title**
  - File: `packages/db/src/mutation-store.ts`
  - Dependencies: 1.1
  - Details:
    - Add `ui_title: string | null` to `Mutation` interface
    - Add `ui_title?: string` to `CreateMutationInput`
    - Update `create()` to include `ui_title`
    - Update `mapRowToMutation()` to read `ui_title`

- [x] **2.7 Mark Event.title as deprecated in Event interface**
  - File: `packages/db/src/event-store.ts`
  - Dependencies: 1.1
  - Details:
    - Add `@deprecated` comment to `title` field in `Event` interface
    - Title is still read for existing events but no longer written for new events

### Phase 3: Topics API Updates

- [x] **3.1 Add register_input to OperationType and PHASE_RESTRICTIONS**
  - File: `packages/agent/src/sandbox/tool-wrapper.ts`
  - Details:
    - Add `'register_input'` to `OperationType` union
    - Add `register_input: true` to producer row, `false` to all others

- [x] **3.2 Create Topics.registerInput tool**
  - File: `packages/agent/src/tools/topics.ts` (or new file)
  - Dependencies: 2.1, 2.2, 3.1
  - Details:
    - Input schema: `{ source, type, id, title }`
    - Output: `string` (inputId)
    - Check phase allowed: `register_input`
    - Call `inputStore.register(workflowId, params, handlerRunId)`
    - Return the inputId

- [x] **3.3 Update Topics.publish for multi-topic support**
  - File: `packages/agent/src/tools/topics.ts`
  - Details:
    - Change input schema `topic` to `z.union([z.string(), z.array(z.string())])`
    - Normalize to array before processing
    - Loop over topics and call `eventStore.publishEvent` for each

- [x] **3.4 Update Topics.publish for inputId/causedBy**
  - File: `packages/agent/src/tools/topics.ts`
  - Dependencies: 2.4, 2.5, 3.1
  - Details:
    - Add `inputId: z.string().optional()` to event schema
    - Remove `title` from event schema (or make optional with deprecation warning)
    - In producer phase: require `inputId`, set `causedBy = [inputId]`
    - In next phase: forbid `inputId`, call `eventStore.getCausedByForRun(handlerRunId)` to inherit

- [x] **3.5 Add Topics.registerInput to sandbox globals**
  - File: `packages/agent/src/sandbox/tool-lists.ts`
  - Dependencies: 3.2
  - Details: Add `makeRegisterInputTool` to workflow tools creation

### Phase 4: WorkflowConfig and Validation

- [x] **4.1 Update WorkflowConfig interface to include publishes**
  - File: `packages/agent/src/workflow-validator.ts`
  - Details:
    - Add `publishes: string[]` to producer config (required)
    - Add `publishes: string[]` to consumer config (optional, empty array if not provided)

- [x] **4.2 Update VALIDATION_CODE for new producer format**
  - File: `packages/agent/src/workflow-validator.ts`
  - Dependencies: 4.1
  - Details:
    - Require `publishes` array for producers: `if (!Array.isArray(p.publishes) || p.publishes.length === 0) throw ...`
    - Extract `publishes` into `producerConfig[name]`

- [x] **4.3 Update VALIDATION_CODE for new consumer format**
  - File: `packages/agent/src/workflow-validator.ts`
  - Dependencies: 4.1
  - Details:
    - Extract optional `publishes` array (default to `[]`)
    - Warn if `publishes.length > 0` but no `next` function
    - Add `publishes` to `consumerConfig[name]`

- [x] **4.4 Add topic graph validation**
  - File: `packages/agent/src/workflow-validator.ts`
  - Dependencies: 4.2, 4.3
  - Details:
    - Check all `publishes` topics reference declared topics
    - Check all `subscribe` topics reference declared topics
    - Throw descriptive error: `Producer 'X': publishes to undeclared topic 'Y'`

### Phase 5: Handler Context Threading

- [x] **5.1 Pass workflowConfig and handlerName to ToolContext**
  - Files: `packages/agent/src/handler-state-machine.ts`, `packages/agent/src/sandbox/tool-lists.ts`
  - Dependencies: 4.1
  - Details:
    - Parse `workflow.handler_config` into `WorkflowConfig`
    - Update `createWorkflowTools()` signature to accept `{ workflowConfig, handlerName }`
    - Pass these to Topics tool factories for topic validation

- [x] **5.2 Implement topic validation in Topics.publish**
  - File: `packages/agent/src/tools/topics.ts`
  - Dependencies: 5.1
  - Details:
    - Get declared topics from `workflowConfig.producers[handlerName].publishes` (producer phase)
    - Get declared topics from `workflowConfig.consumers[handlerName].publishes` (next phase)
    - Throw `LogicError` if publishing to undeclared topic

### Phase 6: PrepareResult.ui and Mutation UI Title

- [x] **6.1 Update handler-state-machine to extract ui.title from PrepareResult**
  - File: `packages/agent/src/handler-state-machine.ts`
  - Dependencies: 2.6
  - Details:
    - In `executeMutate()`, extract `prepareResult.ui?.title`
    - Pass to `mutationStore.create({ ..., ui_title: prepareResult.ui?.title })`

### Phase 7: Prompt Updates

- [x] **7.1 Update planner prompt - producer section**
  - File: `packages/agent/src/agent-env.ts`
  - Dependencies: 3.2, 3.4
  - Details:
    - Add `publishes: ["topic.name"]` to producer example
    - Show `Topics.registerInput()` usage
    - Show `inputId` in `Topics.publish()` call

- [x] **7.2 Update planner prompt - consumer section**
  - File: `packages/agent/src/agent-env.ts`
  - Dependencies: 4.3
  - Details:
    - Add `publishes: ["downstream.topic"]` to consumer example
    - Show `ui: { title: "..." }` in prepare return
    - Show publish without `inputId` in next phase

- [x] **7.3 Update planner prompt - event design section**
  - File: `packages/agent/src/agent-env.ts`
  - Dependencies: 3.2
  - Details:
    - Remove `title` from event design
    - Add Input Registration section with `Topics.registerInput()` example
    - Explain that user-facing metadata is in Input Ledger

- [x] **7.4 Update planner prompt - phase rules**
  - File: `packages/agent/src/agent-env.ts`
  - Dependencies: 3.1
  - Details:
    - Producer: "CAN: Read external systems, publish to declared topics, register inputs"
    - Prepare: "SHOULD: Return { ui: { title: '...' } } when mutation will occur"
    - Next: "CAN: Publish to declared topics (no inputId needed)"

- [x] **7.5 Update planner prompt - full workflow example**
  - File: `packages/agent/src/agent-env.ts`
  - Dependencies: 7.1, 7.2
  - Details: Update the complete example to use `registerInput`, `inputId`, `publishes`, `ui.title`

- [x] **7.6 Update maintainer prompt - constraints**
  - File: `packages/agent/src/agent-env.ts`
  - Details:
    - Add "Cannot Modify": Producer/consumer `publishes` declarations
    - Add "Must Preserve": Input registration logic, inputId linkage

### Phase 8: Testing ✅

- [x] **8.1 Unit tests for InputStore**
  - Dependencies: 2.1
  - Details:
    - Idempotent registration (same source/type/external_id returns existing)
    - Unique constraint enforcement
    - Get by ID and by workflow
  - File: `packages/tests/src/input-store.test.ts` (15 tests)

- [x] **8.2 Unit tests for EventStore causedBy**
  - Dependencies: 2.4, 2.5
  - Details:
    - publishEvent with causedBy stored correctly
    - getCausedByForRun returns union of all reserved events' causedBy
  - File: `packages/tests/src/event-store.test.ts` (added 5 tests)

- [x] **8.3 Unit tests for Topics.publish changes**
  - Dependencies: 3.3, 3.4, 5.2
  - Details:
    - Multi-topic fan-out
    - inputId required in producer phase
    - inputId forbidden in next phase
    - Topic validation against declarations
  - File: `packages/tests/src/topics-api.test.ts` (added 10 tests)

- [x] **8.4 Unit tests for Topics.registerInput**
  - Dependencies: 3.2
  - Details:
    - Phase restriction (producer only)
    - Returns inputId
    - Idempotent behavior
  - File: `packages/tests/src/topics-api.test.ts` (added 5 tests)

- [x] **8.5 Unit tests for validation updates**
  - Dependencies: 4.2, 4.3, 4.4
  - Details:
    - New producer format validates (with publishes)
    - New consumer format validates (with optional publishes)
    - Undeclared topic in publishes throws error
  - File: `packages/tests/src/workflow-validation.test.ts` (25 tests)

- [x] **8.6 Integration test - full causal chain**
  - Dependencies: All Phase 1-5 items
  - Details:
    - Producer registerInput -> publish with inputId
    - Consumer peek -> reserve -> next publish -> caused_by inherited
    - 3-stage pipeline traces back to original input
  - File: `packages/tests/src/topics-api.test.ts` (causal chain test)

- [x] **8.7 Integration test - title deprecation**
  - Dependencies: 2.4, 2.7
  - Details:
    - Verify old events with titles are still readable
    - Verify new events have empty title but valid caused_by
  - File: `packages/tests/src/topics-api.test.ts` (3 title deprecation tests)

---

## Critical Path Summary

The minimum items needed for a working implementation (in order):

1. **v44 migration** (1.1, 1.2)
2. **InputStore** (2.1, 2.2, 2.3)
3. **EventStore updates** (2.4, 2.5)
4. **Phase restrictions** (3.1)
5. **Topics.registerInput** (3.2, 3.5)
6. **Topics.publish updates** (3.3, 3.4)
7. **WorkflowConfig updates** (4.1, 4.2, 4.3)
8. **Handler context threading** (5.1, 5.2)

The prompt updates (Phase 7) and UI title (Phase 6) are important for usability but not blocking for the core functionality.

---

## What This Spec Does NOT Cover

Per the spec, the following are UX-layer concerns for a separate spec (Chapter 17):
- Input Ledger UX (Inputs & Outputs view, skip semantics, pending rollup)
- Output/mutation ledger UX
- Stale input warnings
- Input status computation queries for the UI

---

## Backward Compatibility Notes

1. **Events table**: Existing events with `title` values are preserved. New events get `title = ''`.
2. **WorkflowConfig**: Existing configs without `publishes` will fail validation. Scripts must be re-planned.
3. **Topics.publish signature**: No more `title` in event - backward incompatible. Since all existing scripts need re-planning anyway (exec-02 deprecated Items), this is acceptable.
4. **Existing handler_runs and mutations**: Unaffected. Only new runs use the updated flow.

---

## Current Database Version: 44

**Implementation Complete!** All 8 phases have been implemented and tested:
- Phase 1 & 2: Database foundation and data access layer
- Phase 3: Topics API updates (registerInput, multi-topic, inputId/causedBy)
- Phase 4: WorkflowConfig with publishes declarations
- Phase 5: Handler context threading
- Phase 6: PrepareResult.ui and mutation UI title
- Phase 7: Prompt updates
- Phase 8: Comprehensive test suite (123 new tests)
