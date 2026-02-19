# Fix 05: retryWorkflowSession — Clear `pending_retry_run_id` via EMM-Consistent Pattern

**Priority:** MEDIUM
**File:** `packages/agent/src/session-orchestration.ts`
**Estimated scope:** ~4 lines changed

## Problem

`retryWorkflowSession()` has two fallback paths that clear `pending_retry_run_id`
directly via `scriptStore.updateWorkflowFields()`:

```typescript
// Line 530: Failed run not found
await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
return executeWorkflowSession(workflow, "event", context);

// Line 538: Already retried (race condition)
await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
return executeWorkflowSession(workflow, "event", context);
```

These bypass EMM. The risk is low because these are edge-case error recovery
paths (run missing or already handled), and the clearing is correct behavior.
However, `pending_retry_run_id` is an EMM-controlled field.

## Changes

Replace direct store calls with `emm` calls via the execution context. Since
`context.emm` is available, we can use a lightweight pattern that keeps EMM
as the single writer:

### Option A: Direct EMM store call (recommended)

The EMM exposes its store as private, but `context.emm` has the same `api`.
Since these are simple field-clearing operations (not state transitions with
side effects), we can call through EMM's API reference:

```typescript
// Use the same API that EMM would use, acknowledging this is a cleanup path
await context.emm.clearPendingRetry(workflow.id);
```

This requires adding a small method to EMM:

```typescript
// In execution-model.ts
/**
 * Clear pending_retry_run_id — used by retry orchestration when the
 * referenced run no longer exists or was already retried.
 * This is a cleanup operation, not a state transition.
 */
async clearPendingRetry(workflowId: string): Promise<void> {
  await this.store.updateWorkflowFields(workflowId, {
    pending_retry_run_id: "",
  });
}
```

### Option B: Leave as-is (acceptable)

These are defensive edge-case cleanups. The `pending_retry_run_id` field is
being cleared (not set), which is always safe. The risk of inconsistency is
minimal. Documenting the bypass with a comment is sufficient:

```typescript
// Defensive cleanup: clear stale pending_retry_run_id.
// Bypasses EMM because the referenced run doesn't exist — no state transition needed.
await api.scriptStore.updateWorkflowFields(workflow.id, { pending_retry_run_id: '' });
```

## Recommendation

Option A if we're implementing fix-01 (which extends EMM anyway). Option B if
we want minimal changes.

## Testing

- Build with `turbo run build`
