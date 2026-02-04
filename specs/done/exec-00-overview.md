# Execution Model Refactor - Overview

## Summary

Refactoring Keep.AI from free-form scripts with `Items.withItem()` to structured workflows with topics, producers, consumers, and three-phase execution.

## Specs

| # | Spec | Description | Dependencies |
|---|------|-------------|--------------|
| 01 | [exec-01-database-schema](./exec-01-database-schema.md) | New tables: topics, events, handler_runs, mutations, handler_state | - |
| 02 | [exec-02-deprecate-items](./exec-02-deprecate-items.md) | Remove Items.withItem, Items.list, ItemStore | - |
| 03 | [exec-03-topics-api](./exec-03-topics-api.md) | Add Topics.peek, Topics.publish, Topics.getByIds | 01 |
| 03a | [exec-03a-complete-tool-migration](./exec-03a-complete-tool-migration.md) | Complete api.ts→ToolWrapper migration, add tool-lists.ts | 02, 03 |
| 04 | [exec-04-phase-tracking](./exec-04-phase-tracking.md) | Phase enforcement in sandbox, replace activeItem | 03a |
| 05 | [exec-05-script-validation](./exec-05-script-validation.md) | Validate workflow structure on save/fix | 04 |
| 06 | [exec-06-handler-state-machine](./exec-06-handler-state-machine.md) | Unified state machine for handler execution | 01, 04 |
| 07 | [exec-07-session-orchestration](./exec-07-session-orchestration.md) | Session-based execution, producer+consumer loop | 06 |
| 08 | [exec-08-planner-prompts](./exec-08-planner-prompts.md) | Update prompts for new script format | 05 |

## Implementation Order

### Phase A: Infrastructure (can be done in parallel)
1. **exec-01**: Database schema - new tables and columns
2. **exec-02**: Deprecate items - remove old infrastructure

### Phase B: Sandbox Changes
3. **exec-03**: Topics API - add Topics global
4. **exec-03a**: Complete tool migration - tool-lists.ts, switch workers to ToolWrapper
5. **exec-04**: Phase tracking - add phase enforcement to ToolWrapper

### Phase C: Execution Engine
6. **exec-05**: Script validation - validate on save/fix
7. **exec-06**: Handler state machine - core execution loop
8. **exec-07**: Session orchestration - session-based execution

### Phase D: LLM Integration
9. **exec-08**: Planner prompts - generate new format scripts

## Key Concepts

### Old Model
- Free-form JS scripts
- `Items.withItem(id, title, handler)` for mutation tracking
- Single execution flow

### New Model
- Structured `const workflow = { ... }` object
- **Topics**: Internal event streams
- **Producers**: Poll external systems, publish events
- **Consumers**: Three-phase processing (prepare → mutate → next)
- **Sessions**: Group handler runs for "Run once" UX

### Three-Phase Consumer Execution

```
prepare: Select inputs, compute mutation params (read-only)
    ↓
mutate: Perform ONE external mutation (optional)
    ↓
next: Publish downstream events, update state (optional)
```

### State Machine

All handlers run through unified state machine:
- Same code handles normal execution and restart recovery
- Each phase transition checkpointed to DB
- Crash at any point → restart continues from last checkpoint

## Migration Notes

- Existing workflows using `Items.withItem()` will need re-planning
- `items` table kept for data preservation, marked deprecated
- Old `script_runs` reused as session container
- New `handler_runs` for granular execution tracking

## Related Docs

- [docs/dev/06-execution-model.md](../../docs/dev/06-execution-model.md)
- [docs/dev/06a-topics-and-handlers.md](../../docs/dev/06a-topics-and-handlers.md)
- [docs/dev/06b-consumer-lifecycle.md](../../docs/dev/06b-consumer-lifecycle.md)
- [docs/dev/IMPLEMENTATION-PLAN-EXECUTION-MODEL.md](../../docs/dev/IMPLEMENTATION-PLAN-EXECUTION-MODEL.md)
