# Fix 07: escalateToUser — Use EMM for Workflow Field Updates

**Priority:** LOW
**File:** `packages/agent/src/workflow-escalation.ts`
**Estimated scope:** ~10 lines changed

## Problem

`escalateToUser()` modifies workflow fields directly:

```typescript
await api.scriptStore.updateWorkflowFields(workflow.id, {
  error: `Max fix attempts exhausted (${fixAttempts}/${MAX_FIX_ATTEMPTS}): ${error.message}`,
  maintenance: false,
  maintenance_fix_count: 0,
});
```

This sets `workflow.error` and clears `maintenance` outside EMM. The operation
is a terminal escalation (no handler runs or events involved at this point),
so the risk is low. But `workflow.error` and `maintenance` are EMM-controlled
fields.

## Approach: Use EMM's `blockWorkflow()` + `exitMaintenanceMode()`

If fix-06 adds `blockWorkflow()` to EMM, escalation can use it:

```typescript
await emm.blockWorkflow(
  workflow.id,
  `Max fix attempts exhausted (${fixAttempts}/${MAX_FIX_ATTEMPTS}): ${error.message}`,
);
await emm.exitMaintenanceMode(workflow.id);
// Reset fix count separately (not an EMM concern)
await api.scriptStore.resetMaintenanceFixCount(workflow.id);
```

However, this splits what's currently a single `updateWorkflowFields` call into
three separate operations. The fix count reset is not critical for atomicity
(it's just bookkeeping for user display).

## Alternative: Add `escalateWorkflow()` to EMM

A dedicated method that atomically handles escalation:

```typescript
// In execution-model.ts
/**
 * Escalate a workflow — max fix attempts exhausted, user must intervene.
 * Atomically: set error, clear maintenance, reset fix count.
 */
async escalateWorkflow(workflowId: string, error: string): Promise<void> {
  await this.store.updateWorkflowFields(workflowId, {
    error,
    maintenance: false,
    maintenance_fix_count: 0,
  });
}
```

## Changes

### Option A: Use blockWorkflow + exitMaintenanceMode (depends on fix-06)

```typescript
export async function escalateToUser(
  api: KeepDbApi,
  emm: ExecutionModelManager,   // new parameter
  options: EscalateToUserOptions,
): Promise<EscalateToUserResult> {
  // ...
  await emm.blockWorkflow(
    workflow.id,
    `Max fix attempts exhausted (${fixAttempts}/${MAX_FIX_ATTEMPTS}): ${error.message}`,
  );
  await emm.exitMaintenanceMode(workflow.id);
  await api.scriptStore.resetMaintenanceFixCount(workflow.id);
  // ...
}
```

Callers need to pass `emm` — currently called from:
- `workflow-scheduler.ts:enterMaintenanceModeForSession` (has `this.api`)
  Needs `emm` from context or class field.

### Option B: Add escalateWorkflow to EMM (self-contained)

Add the method to EMM as shown above. Then:

```typescript
export async function escalateToUser(
  api: KeepDbApi,
  emm: ExecutionModelManager,
  options: EscalateToUserOptions,
): Promise<EscalateToUserResult> {
  // ...
  await emm.escalateWorkflow(
    workflow.id,
    `Max fix attempts exhausted (${fixAttempts}/${MAX_FIX_ATTEMPTS}): ${error.message}`,
  );
  // ...
}
```

### Option C: Leave as-is with comment

The escalation is a terminal operation with no crash-window risks. Adding a
comment acknowledging the EMM bypass is sufficient:

```typescript
// Escalation: set error + clear maintenance atomically.
// Uses direct store call (not EMM) since this is a terminal escalation
// with no handler run or event side effects.
await api.scriptStore.updateWorkflowFields(workflow.id, {
  error: `Max fix attempts exhausted ...`,
  maintenance: false,
  maintenance_fix_count: 0,
});
```

## Recommendation

Option B if implementing fix-06 (which adds `blockWorkflow` to EMM anyway).
Option C if fix-06 is deferred.

## Testing

- Build with `turbo run build`
- Verify escalation notification still created
- Verify escalation message still sent to user's chat
