# Fix 03: task-worker.ts — Use `workflow.error` Instead of `status: "error"`

**Priority:** HIGH
**File:** `packages/agent/src/task-worker.ts`
**Estimated scope:** ~3 lines changed

## Problem

The `escalateMaintainerFailure()` method in task-worker.ts sets
`workflow.status = "error"` when the maintainer fails to fix a workflow:

```typescript
await this.api.scriptStore.updateWorkflowFields(workflowId, {
  status: "error",          // <-- user-controlled field
  maintenance: false,
  maintenance_fix_count: 0,
});
```

With the EMM model, `workflow.status` is user-controlled (draft/ready/active/paused)
and `workflow.error` is system-controlled. The scheduler now checks `w.error` to
block workflows, not `w.status === "error"`.

Currently this still "works" because the scheduler also checks
`w.status !== "active"`, which catches `status: "error"`. But it's inconsistent
with the EMM model and masks the intent — the user can't simply "resume" a
workflow with `status: "error"` since there's no UI path for that status value.

## Changes

In `escalateMaintainerFailure()`:

Before:
```typescript
await this.api.scriptStore.updateWorkflowFields(workflowId, {
  status: "error",
  maintenance: false,
  maintenance_fix_count: 0,
});
```

After:
```typescript
await this.api.scriptStore.updateWorkflowFields(workflowId, {
  error: "Maintainer failed to fix the script automatically",
  maintenance: false,
  maintenance_fix_count: 0,
});
```

The workflow keeps `status: "active"`. The scheduler blocks it via `w.error`.
The user can clear the error by re-activating the script or fixing the issue.

## Testing

- Build with `turbo run build`
- Verify notification is still created (following lines are unchanged)
