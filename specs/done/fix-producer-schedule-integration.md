# Fix: Wire Up Per-Producer Schedule Integration

## Problem

The per-producer scheduling feature (exec-13) has all infrastructure built but is completely non-functional because:

1. **Schedule initialization never called**: `initializeProducerSchedules()`, `updateProducerSchedules()`, `removeProducerSchedules()` from `packages/agent/src/producer-schedule-init.ts` are exported but never called anywhere in the application lifecycle.

2. **Scheduler uses old workflow-level timestamp**: `WorkflowScheduler.processNextWorkflow()` (line 289-310) still checks `workflow.next_run_timestamp` to decide which workflows are due, not the `producer_schedules` table.

3. **Result**: All producers in a workflow share a single cron-based schedule. A workflow with Producer A (every 5m) and Producer B (every 1h) cannot schedule them independently.

## What Already Works

- `producer_schedules` table (migration v43)
- `ProducerScheduleStore` with full CRUD + `getDueProducers()` (24 tests passing)
- `schedule-utils.ts` with `parseInterval()`, `computeNextRunTime()`, `extractSchedule()`
- `producer-schedule-init.ts` with init/update/remove functions
- `commitProducer()` in handler-state-machine.ts updates `next_run_at` after each producer run

## What Needs Wiring

### 1. Initialize schedules on workflow save/activation

**Where**: When `handler_config` is saved on a workflow (via save tool or workflow validation), call `initializeProducerSchedules()`.

Look at how `handler_config` is written to the workflow in `packages/agent/src/ai-tools/save.ts` and/or `packages/agent/src/workflow-validator.ts`. After `handler_config` is persisted, call:

```typescript
import { initializeProducerSchedules } from "./producer-schedule-init";

await initializeProducerSchedules(workflowId, parsedConfig, api.producerScheduleStore);
```

### 2. Update schedules on config change

When workflow config is updated (same save path), call `updateProducerSchedules()` instead of `initializeProducerSchedules()` if schedules already exist.

### 3. Remove schedules on workflow deletion/deactivation

When a workflow is deleted or its status changes to non-active, call `removeProducerSchedules()`.

### 4. Scheduler should query per-producer schedules

**Where**: `packages/agent/src/workflow-scheduler.ts`, `processNextWorkflow()` method (lines 289-310).

**Current logic** (to replace):
```typescript
// Checks workflow.next_run_timestamp for ALL workflows
if (nextRunTime <= currentTime) {
  dueWorkflows.push(workflow);
}
```

**New logic** (approach):
For each active workflow, query `producerScheduleStore.getDueProducers(workflowId)`. If any producers are due, the workflow needs to execute. The session orchestration will handle which specific producers to run.

Alternatively: Query all due producers across all workflows in a single query (add `getAllDueProducers()` method to store if needed).

### 5. Post-execution: stop updating workflow.next_run_timestamp

**Where**: `workflow-scheduler.ts` lines 353-389.

After session execution, the scheduler currently recalculates `workflow.next_run_timestamp` from `workflow.cron`. This should either:
- Be removed (per-producer schedules handle timing via `commitProducer()`)
- Or kept as fallback for legacy workflows without `handler_config`

## Scope

- Only wire up existing functions to existing lifecycle hooks
- No new tables, no new store methods needed
- Maintain backward compatibility with legacy workflows (check `isNewFormatWorkflow()`)

## Files to Modify

| File | Change |
|------|--------|
| `packages/agent/src/ai-tools/save.ts` or equivalent | Call `initializeProducerSchedules` on save |
| `packages/agent/src/workflow-scheduler.ts` | Query `producer_schedules` for due producers |
| `packages/agent/src/workflow-scheduler.ts` | Stop overwriting `next_run_timestamp` for new-format workflows |

## Testing

- Verify producer schedules are created when workflow is saved with handler_config
- Verify scheduler picks up workflows with due producer schedules
- Verify different producers in same workflow can have independent schedules
- Verify legacy workflows (no handler_config) still work with old cron logic
