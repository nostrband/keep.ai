# Fix 06: Scheduler — Use EMM for `workflow.error` Setting

**Priority:** LOW
**File:** `packages/agent/src/workflow-scheduler.ts`
**Estimated scope:** ~15 lines changed

## Problem

Two places in the scheduler set `workflow.error` directly:

1. **Max network retries exceeded** (line 92):
   ```typescript
   await this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
     error: signal.error || 'Max retries exceeded',
     pending_retry_run_id: '',
   });
   ```

2. **Missing handler_config** (line 454):
   ```typescript
   await this.api.scriptStore.updateWorkflowFields(w.id, {
     error: 'Workflow has no handler configuration...',
   });
   ```

These are scheduler-level decisions (not handler execution), so they don't
naturally fit existing EMM methods. They don't involve handler runs, events,
or mutations — just workflow-level error flagging.

## Approach: Add `blockWorkflow()` to EMM

A simple method that sets `workflow.error` (and optionally clears
`pending_retry_run_id`). This keeps EMM as the single writer for
`workflow.error` without adding unnecessary complexity.

```typescript
// In execution-model.ts
/**
 * Block a workflow with an error — scheduler-level decision.
 * Sets workflow.error (system-controlled). Does NOT touch workflow.status.
 * Optionally clears pending_retry_run_id (e.g., max retries exceeded).
 */
async blockWorkflow(
  workflowId: string,
  error: string,
  opts?: { clearPendingRetry?: boolean },
): Promise<void> {
  const fields: Record<string, any> = { error };
  if (opts?.clearPendingRetry) fields.pending_retry_run_id = "";
  await this.store.updateWorkflowFields(workflowId, fields);
}
```

## Changes

### 1. Add `blockWorkflow()` to EMM (execution-model.ts)

As shown above. Simple, no transaction needed (single store call).

### 2. Max network retries (workflow-scheduler.ts ~line 92)

Before:
```typescript
await this.api.scriptStore.updateWorkflowFields(signal.workflowId, {
  error: signal.error || 'Max retries exceeded',
  pending_retry_run_id: '',
});
```

After:
```typescript
const emm = new ExecutionModelManager(this.api);
await emm.blockWorkflow(signal.workflowId, signal.error || 'Max retries exceeded', {
  clearPendingRetry: true,
});
```

Note: `handleWorkerSignal` doesn't have access to `this.createExecutionContext()`.
Either instantiate EMM directly or store a class-level EMM instance.

### 3. Missing handler_config (workflow-scheduler.ts ~line 454)

Before:
```typescript
await this.api.scriptStore.updateWorkflowFields(w.id, {
  error: 'Workflow has no handler configuration. Re-activate the script to fix.',
});
```

After:
```typescript
const emm = new ExecutionModelManager(this.api);
await emm.blockWorkflow(w.id, 'Workflow has no handler configuration. Re-activate the script to fix.');
```

### 4. (Optional) Store EMM as class field

Instead of creating EMM instances inline, add a class-level field:

```typescript
class WorkflowScheduler {
  private emm: ExecutionModelManager;

  constructor(config: WorkflowSchedulerConfig) {
    this.api = config.api;
    this.emm = new ExecutionModelManager(config.api);
    // ...
  }
}
```

Then use `this.emm.blockWorkflow(...)` everywhere.

## Recommendation

Implement if doing fix-01 or fix-05 (which also extend EMM). Skip if those
are deferred — the current direct calls work correctly.

## Testing

- Build with `turbo run build`
