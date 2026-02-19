# Fix 04: Resume Workflow — Must Clear `workflow.error`

**Priority:** MEDIUM
**Files:**
- `apps/web/src/hooks/useNotifications.ts` (useResumeWorkflows)
- `apps/web/src/hooks/dbWrites.ts` (useUpdateWorkflow)

**Estimated scope:** ~5 lines changed

## Problem

### useResumeWorkflows (useNotifications.ts:241)

When a user resumes a workflow from a notification, the hook sets:
```typescript
await api.scriptStore.updateWorkflowFields(w.workflowId, { status: "active" });
```

This doesn't clear `workflow.error`. Since the scheduler now checks `w.error`
to block workflows, the workflow remains blocked even after the user clicks
"Resume". The resume action has no effect on scheduling.

### useUpdateWorkflow (dbWrites.ts:168-174)

The general workflow update hook passes through `status`, `title`, `cron`,
`next_run_timestamp`. When the user pauses/resumes via this hook, it sets
`status: "active"` but doesn't clear `error`. Same problem.

## Changes

### 1. useResumeWorkflows (useNotifications.ts)

Before:
```typescript
await api.scriptStore.updateWorkflowFields(w.workflowId, { status: "active" });
```

After:
```typescript
await api.scriptStore.updateWorkflowFields(w.workflowId, { status: "active", error: "" });
```

### 2. useUpdateWorkflow (dbWrites.ts)

When `status` is set to `"active"`, also clear `error`:

Before:
```typescript
const fields: Parameters<typeof api.scriptStore.updateWorkflowFields>[1] = {};
if (input.status !== undefined) fields.status = input.status;
if (input.title !== undefined) fields.title = input.title;
// ...
```

After:
```typescript
const fields: Parameters<typeof api.scriptStore.updateWorkflowFields>[1] = {};
if (input.status !== undefined) {
  fields.status = input.status;
  // Clear system error when user activates workflow (error is system-controlled,
  // user resume is an implicit "I've fixed the issue")
  if (input.status === "active") fields.error = "";
}
if (input.title !== undefined) fields.title = input.title;
// ...
```

## Rationale

When a user explicitly resumes/activates a workflow, they're asserting "the
issue is fixed" (e.g., they reconnected auth, fixed the script, etc.). Clearing
`workflow.error` is the correct semantic — the user is overriding the system
block.

This is consistent with EMM's `resumeWorkflow()` which notes:
> If workflow.error is set, the scheduler still won't run — the error must be
> resolved first.

The user's explicit resume IS the resolution.

## Testing

- Verify resuming a workflow with `error` set clears the error
- Verify scheduler picks up the workflow after resume
- Build with `turbo run build`
