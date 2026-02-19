# Integration Topic 9: Scheduler Integration

> Depends on: All previous topics (1-8)

## Summary

Update `WorkflowScheduler` to work with the new execution model. Key changes:
- Workflow filtering uses `error=""` instead of `status="active"` for system state
- Remove `workflow.status="error"/"paused"` system-controlled changes
- Update signal routing for new SessionResult semantics
- Maintenance entry point uses EMM
- Remove indeterminate mutation guard (handled by workflow.error)

## Current State

### Workflow filtering in `processNextWorkflow()` (lines 406-441)

```typescript
// Current:
if (w.status !== 'active' || w.maintenance) continue;
// Also: guard for indeterminate mutations (re-pauses workflow)
const indeterminate = await this.api.mutationStore.getByWorkflow(w.id, { status: "indeterminate" });
if (indeterminate.length > 0) {
  await this.api.scriptStore.updateWorkflowFields(w.id, { status: 'paused' });
  continue;
}
```

### `handleSessionResult()` (lines 681-746)

Routes session results to signals. Currently sets `pending_retry_run_id` for
transient errors. After EMM, this is handled atomically.

### `postSessionResult()` (lines 616-624)

Calls `enterMaintenanceModeForSession()` then `handleSessionResult()`.

### `enterMaintenanceModeForSession()` (lines 631-676)

Re-fetches workflow, checks fix count, either enters maintenance or escalates.
Uses `this.api.enterMaintenanceMode()`.

### `handleWorkerSignal()` (lines 63-148)

- `retry`: exponential backoff, max retries → sets workflow.status="error"
- `payment_required`: global pause
- `done`: clear retry state, reset maintenance_fix_count
- `needs_attention`: clear retry state
- `maintenance`: clear retry state

## Changes Required

### 1. Workflow filtering — use `error` field

```typescript
// BEFORE:
if (w.status !== 'active' || w.maintenance) continue;

// AFTER:
if (w.status !== 'active' || w.maintenance || w.error) continue;
// workflow.error is system-controlled: non-empty means needs user attention
```

### 2. Remove indeterminate mutation guard

```typescript
// BEFORE:
const indeterminate = await this.api.mutationStore.getByWorkflow(w.id, { status: "indeterminate" });
if (indeterminate.length > 0) {
  await this.api.scriptStore.updateWorkflowFields(w.id, { status: 'paused' });
  continue;
}

// AFTER: Remove entirely.
// EMM sets workflow.error on paused:reconciliation which includes indeterminate.
// The error="" check above catches this.
```

### 3. Update `handleWorkerSignal('retry')` — max retries

```typescript
// BEFORE (max retries exceeded):
await this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
  status: 'error',
  pending_retry_run_id: '',
});

// AFTER:
// Set workflow.error instead of workflow.status
await this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
  error: signal.error || 'Max retries exceeded',
  pending_retry_run_id: '',
});
// workflow.status stays "active" (user-controlled)
```

### 4. Simplify `handleSessionResult()`

```typescript
// AFTER:
private async handleSessionResult(workflowId: string, result: SessionResult): Promise<void> {
  switch (result.status) {
    case 'completed':
      await this.handleWorkerSignal({ type: 'done', workflowId, ... });
      break;

    case 'suspended':
      // Run was paused (approval/reconciliation). EMM already set workflow.error.
      // Clear retry state - user needs to resolve.
      this.workflowRetryState.delete(workflowId);
      break;

    case 'failed':
      // EMM already set workflow.error for non-logic failures.
      // Session already finalized by EMM.
      await this.handleWorkerSignal({ type: 'needs_attention', workflowId, ... });
      break;

    case 'maintenance':
      // EMM set maintenance=true. enterMaintenanceModeForSession creates task.
      await this.handleWorkerSignal({ type: 'maintenance', workflowId, ... });
      break;

    case 'transient':
      // EMM handled event disposition + pending_retry (if post-mutation).
      // REMOVE: await this.api.scriptStore.updateWorkflowFields(...pending_retry_run_id...)
      await this.handleWorkerSignal({ type: 'retry', workflowId, ... });
      break;
  }
}
```

### 5. Update `enterMaintenanceModeForSession()`

The maintenance flag is already set atomically by EMM's `updateHandlerRunStatus(failed:logic)`.
This function now only needs to handle the *task creation* (which is external to EMM):

```typescript
private async enterMaintenanceModeForSession(
  workflow: Workflow,
  result: SessionResult
): Promise<void> {
  const freshWorkflow = await this.api.scriptStore.getWorkflow(workflow.id);
  if (!freshWorkflow) return;

  const fixCount = freshWorkflow.maintenance_fix_count || 0;

  if (fixCount + 1 >= MAX_FIX_ATTEMPTS) {
    // Escalate to user (clears maintenance, sets workflow.error)
    await escalateToUser(this.api, { ... });
    return;
  }

  // Create maintainer task (maintenance flag already set by EMM)
  await this.api.enterMaintenanceMode({ ... });
}
```

### 6. Update `escalateToUser()` to use workflow.error

```typescript
// BEFORE (in workflow-escalation.ts):
await api.scriptStore.updateWorkflowFields(workflow.id, {
  status: 'error',
  maintenance: false,
  maintenance_fix_count: 0,
});

// AFTER:
await api.scriptStore.updateWorkflowFields(workflow.id, {
  error: 'Max fix attempts exhausted - user intervention required',
  maintenance: false,
  maintenance_fix_count: 0,
});
// workflow.status stays "active"
```

### 7. Add notification creation for auth errors

Moved from `handleApprovalNeeded()` (Topic 6) to here:

```typescript
// In postSessionResult or handleSessionResult:
if (result.status === 'suspended' || result.status === 'failed') {
  if (result.errorType === 'auth' || result.errorType === 'permission') {
    await this.createAuthNotification(workflow, result);
  }
}
```

### 8. Handle `workflow.error` clearing

When does `workflow.error` get cleared?
- Mutation resolution: EMM's `applyMutation/failMutation/skipMutation` clear it
- Auth reconnect: External code that handles OAuth reconnection should call
  `api.scriptStore.updateWorkflowFields(workflowId, { error: '' })`
- Manual retry: User clicks "try again" → clear error

This may need a new method or the existing reconnection flow needs updating.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/workflow-scheduler.ts` | Update filtering, signal routing, remove redundant pending_retry |
| `packages/agent/src/workflow-escalation.ts` | Use workflow.error instead of workflow.status="error" |

## Verification

- Active workflows with `error=""` and `!maintenance` run normally
- Active workflows with `error!=""` are skipped
- Transient retry backoff still works
- Maintenance escalation uses workflow.error
- Auth error notifications still created
- No more system-controlled workflow.status changes
- `turbo run build` passes
