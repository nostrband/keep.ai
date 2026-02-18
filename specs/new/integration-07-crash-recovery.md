# Integration Topic 7: Crash Recovery

> Depends on: Topic 1 (DB schema), Topic 2 (handler run status)

## Summary

Replace `resumeIncompleteSessions()` in `session-orchestration.ts` with
`ExecutionModelManager.recoverCrashedRuns()`, `recoverUnfinishedSessions()`,
`recoverMaintenanceMode()`, and `assertNoOrphanedReservedEvents()`.

Also replace `eventStore.releaseOrphanedReservedEvents()` with the diagnostic assertion.

## Current State

### `resumeIncompleteSessions()` in session-orchestration.ts (lines 737-866)

1. Finds workflows with `status='active'` that have incomplete handler runs
2. Skips paused/error workflows
3. For each incomplete run:
   - **Path A** (mutating + in_flight mutation): mark indeterminate + set pending_retry + pause workflow
   - **Path B** (post-mutation): mark crashed + set pending_retry
   - **Path C** (pre-mutation): mark crashed, NO pending_retry

**Problems (from spec):**
- Bug 5: Only finds `status='active'` workflows. If crash happened after failRun() wrote
  terminal status but before pending_retry was set, it's missed.
- Non-atomic: transaction only covers mark+session+pending_retry, not workflow.error
- Doesn't finalize sessions properly (only closes session, doesn't aggregate cost)

### `releaseOrphanedReservedEvents()` in event-store.ts

Called on startup in `workflow-scheduler.ts` (line 209). Silently releases
orphaned reserved events. Per spec, this should be replaced with a diagnostic
assertion that logs loudly but does NOT release.

### Startup sequence in `workflow-scheduler.ts` (lines 176-221)

```typescript
await this.resumeIncompleteSessions();
await this.initializeSchedulerState();
await this.backfillScriptHandlerConfigs();
await this.ensureProducerSchedules();
await this.api.eventStore.releaseOrphanedReservedEvents();
```

## Changes Required

### 1. Replace `resumeIncompleteSessions()` call

```typescript
// BEFORE (in workflow-scheduler.ts):
await this.resumeIncompleteSessions();

// AFTER:
const emm = new ExecutionModelManager(this.api);
await emm.recoverCrashedRuns();
await emm.recoverUnfinishedSessions();
const maintenanceWorkflowIds = await emm.recoverMaintenanceMode();
// Create maintenance tasks for recovered workflows
for (const wfId of maintenanceWorkflowIds) {
  await this.ensureMaintenanceTask(wfId);
}
```

### 2. Replace `releaseOrphanedReservedEvents()` call

```typescript
// BEFORE:
const released = await this.api.eventStore.releaseOrphanedReservedEvents();

// AFTER:
await emm.assertNoOrphanedReservedEvents();
// This logs loudly if orphans found but does NOT release them
```

### 3. New startup sequence

```typescript
// In workflow-scheduler.ts start():
const emm = new ExecutionModelManager(this.api);

// Step 1: Recover crashed runs (marks crashed, handles events atomically)
await emm.recoverCrashedRuns();

// Step 2: Recover unfinished sessions (finalize sessions where all runs committed)
await emm.recoverUnfinishedSessions();

// Step 3: Recover maintenance mode (find maintenance=true without active task)
const maintenanceWorkflowIds = await emm.recoverMaintenanceMode();
for (const wfId of maintenanceWorkflowIds) {
  await this.ensureMaintenanceTask(wfId);
}

// Step 4: Diagnostic assertion (must be AFTER recoverCrashedRuns)
await emm.assertNoOrphanedReservedEvents();

// Step 5: Initialize scheduler state (unchanged)
await this.initializeSchedulerState();

// Step 6: Backfill configs (unchanged)
await this.backfillScriptHandlerConfigs();

// Step 7: Ensure producer schedules (unchanged)
await this.ensureProducerSchedules();
```

### 4. Add `ensureMaintenanceTask()` to scheduler

```typescript
private async ensureMaintenanceTask(workflowId: string): Promise<void> {
  // Check if there's already an active maintainer task
  // (Check inbox/task system for active maintainer task for this workflow)
  // If not, call api.enterMaintenanceMode(...)
  // This covers the crash window between maintenance flag and task creation
}
```

The exact implementation depends on how the task system queries work.
This might be a simple DB query or may need the existing enterMaintenanceMode logic.

### 5. Remove `resumeIncompleteSessions()` function

After replacement, delete from `session-orchestration.ts` (lines 737-866).
Also remove the private wrapper in `workflow-scheduler.ts`.

### 6. Consider removing `releaseOrphanedReservedEvents()` from event-store

The method becomes obsolete. However, it may be safer to keep it as a manual
recovery tool (callable from admin CLI) but remove it from the automatic startup path.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/workflow-scheduler.ts` | New startup sequence with EMM recovery methods |
| `packages/agent/src/session-orchestration.ts` | Remove resumeIncompleteSessions() |

## Verification

- All crash scenarios from spec (scenarios 11a/11b/11c) are handled
- No orphaned reserved events after recovery
- Maintenance mode recovered correctly
- Unfinished sessions (all runs committed) are finalized
- Bug 5 fixed: recovery finds runs regardless of workflow status
- `turbo run build` passes
