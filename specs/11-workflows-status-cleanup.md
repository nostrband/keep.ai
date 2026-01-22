# Spec 11: Workflows Status Cleanup

## Overview

Standardize workflow status values to be explicit and consistent. Change from implicit empty string for draft to explicit status values.

## Status Value Changes

| Old Value | New Value | Meaning |
|-----------|-----------|---------|
| `""` (empty) | `"draft"` | No script yet, cannot run |
| *(new)* | `"ready"` | Has script, not yet activated |
| `"active"` | `"active"` | Running on schedule |
| `"disabled"` | `"paused"` | User paused |
| `"error"` | `"error"` | Needs user attention |

## Status Transitions

```
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  │
┌─────────┐   save script   ┌─────────┐   activate   ┌─────────┐
│  draft  │ ───────────────►│  ready  │ ────────────►│  active │
└─────────┘                 └─────────┘              └────┬────┘
                                 ▲                        │
                                 │                   pause│resume
                                 │                        ▼
                                 │                   ┌─────────┐
                                 │                   │  paused │
                                 │                   └────┬────┘
                                 │                        │
                                 │    ┌───────────────────┘
                                 │    │ (user-attention error OR
                                 │    │  escalated after 3 fix attempts)
                                 │    ▼
                                 │ ┌─────────┐
                                 └─│  error  │ (user fixes, resumes → active)
                                   └─────────┘
```

**Key transitions:**
- `draft` → `ready`: When first script is saved (automatic)
- `ready` → `active`: User clicks Activate
- `active` → `paused`: User clicks Pause
- `paused` → `active`: User clicks Resume
- `active` → `error`: Auth/permission/network error OR escalated after 3 failed auto-fix attempts
- `error` → `active`: User resolves issue and resumes

**Note:** `maintenance` flag is orthogonal - workflow can be in any status while `maintenance=true`.

## Database Migration (v29)

```sql
-- Update existing status values
UPDATE workflows SET status = 'draft' WHERE status = '';
UPDATE workflows SET status = 'paused' WHERE status = 'disabled';

-- Update workflows that have scripts but are still draft to 'ready'
UPDATE workflows
SET status = 'ready'
WHERE status = 'draft'
  AND active_script_id != '';
```

**File:** `packages/db/src/migrations/v29.ts`

## Files to Modify

### 1. Database Layer

#### `packages/db/src/migrations/v29.ts` (NEW)
Create migration to update existing status values.

#### `packages/db/src/script-store.ts`

**Update Workflow type comments:**
```typescript
export interface Workflow {
  id: string;
  title: string;
  task_id: string;
  chat_id: string;           // Added in Spec 09
  timestamp: string;
  cron: string;
  events: string;
  status: string;            // 'draft' | 'ready' | 'active' | 'paused' | 'error'
  next_run_timestamp: string;
  maintenance: boolean;
  maintenance_fix_count: number;
  active_script_id: string;
}
```

**Update `addWorkflow()`** - Default status should be `'draft'`:
```typescript
// Ensure new workflows start with 'draft' status
const status = workflow.status || 'draft';
```

**Update `getStaleWorkflows()`** (line ~833):
```typescript
// Before
WHERE w.status = ''

// After
WHERE w.status = 'draft'
```

**Update `getDraftActivitySummary()`** (line ~906):
```typescript
// Before
WHERE w.status = ''

// After
WHERE w.status = 'draft'
```

### 2. Agent Code

#### `packages/agent/src/workflow-scheduler.ts`

**Line 218** - Active workflow filter (unchanged, 'active' stays same):
```typescript
const activeWorkflows = allWorkflows.filter(
  (w) => w.status === 'active' && !w.maintenance
);
```

**Lines 85-86** - Already sets 'error', no change needed.

#### `packages/agent/src/workflow-worker.ts`

**Line 89** - Check if workflow is active (unchanged):
```typescript
if (!workflow || workflow.status !== 'active') {
  throw new WorkflowPausedError(this.workflowId);
}
```

**Lines 662-665** - Escalation after max fix attempts:
```typescript
// Before
await this.api.scriptStore.updateWorkflowFields(workflow.id, {
  status: "disabled",
  maintenance: false,
  maintenance_fix_count: 0,
});

// After
await this.api.scriptStore.updateWorkflowFields(workflow.id, {
  status: "error",  // Changed from 'disabled' to 'error'
  maintenance: false,
  maintenance_fix_count: 0,
});
```

#### `packages/agent/src/sandbox/api.ts`

**Line 89** - Check if workflow is active (unchanged):
```typescript
if (!workflow || workflow.status !== 'active') {
  throw new WorkflowPausedError(this.workflowId);
}
```

#### `packages/agent/src/ai-tools/save.ts`

**When first script is saved, update status from 'draft' to 'ready':**
```typescript
// After saving script, if workflow was draft, move to ready
if (workflow.status === 'draft') {
  await opts.scriptStore.updateWorkflowFields(workflow.id, {
    status: 'ready',
    active_script_id: newScript.id,
  });
} else {
  // Just update active_script_id
  await opts.scriptStore.updateWorkflowFields(workflow.id, {
    active_script_id: newScript.id,
  });
}
```

### 3. UI Components

#### `apps/web/src/components/StatusBadge.tsx`

**Update for new status values:**
```typescript
// Before
if (status === "disabled") {
  return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
} else if (status === "active") {
  return <Badge className="bg-green-100 text-green-800">Running</Badge>;
} else {
  return <Badge variant="outline">Draft</Badge>;
}

// After
switch (status) {
  case "active":
    return <Badge className="bg-green-100 text-green-800">Running</Badge>;
  case "paused":
    return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
  case "error":
    return <Badge className="bg-red-100 text-red-800">Error</Badge>;
  case "ready":
    return <Badge className="bg-blue-100 text-blue-800">Ready</Badge>;
  case "draft":
  default:
    return <Badge variant="outline">Draft</Badge>;
}
```

#### `apps/web/src/components/WorkflowDetailPage.tsx`

**Line 73** - Show next run time for active:
```typescript
// Unchanged - 'active' stays same
if (!workflow?.next_run_timestamp || workflow.status !== 'active') {
  return null;
}
```

**Line 90** - Handle Activate:
```typescript
// Now works from 'ready' status instead of ''
updateWorkflowMutation.mutate({
  workflowId: workflow.id,
  status: "active",
})
```

**Line 103** - Handle Pause:
```typescript
// Before
status: "disabled"

// After
status: "paused"
```

**Line 116** - Handle Resume:
```typescript
// Unchanged - sets to 'active'
status: "active"
```

**Line 245** - Show Activate button for ready (not draft):
```typescript
// Before
{workflow.status === "" && activeScript && (

// After
{workflow.status === "ready" && (
  <Button onClick={handleActivate}>Activate</Button>
)}
```

**Line 256** - Show Run now for draft, ready, and active:
```typescript
// Before
{(workflow.status === "" || workflow.status === "active") && activeScript && (

// After
{(workflow.status === "draft" || workflow.status === "ready" || workflow.status === "active") && activeScript && (
  <Button onClick={handleRunNow}>Run now</Button>
)}
```

**Line 280** - Show Pause button for active:
```typescript
// Unchanged - 'active' stays same
{workflow.status === "active" && (
  <Button onClick={handlePause}>Pause</Button>
)}
```

**Line 292** - Show Resume button for paused AND error:
```typescript
// Before
{workflow.status === "disabled" && (

// After
{(workflow.status === "paused" || workflow.status === "error") && (
  <Button onClick={handleResume}>Resume</Button>
)}
```

**Line 315** - Show script requirement hint for draft:
```typescript
// Before
{workflow.status === "" && !activeScript && (

// After
{workflow.status === "draft" && (
  <div>Script required to activate</div>
)}
```

#### `apps/web/src/components/WorkflowEventGroup.tsx`

**Line 45** - Check if workflow can retry:
```typescript
// Unchanged - 'active' stays same
if (workflow.status !== 'active') {
  success.show("Enable workflow first to retry");
  return;
}
```

#### `apps/web/src/components/MainPage.tsx`

**Line 103** - Show next run time for active:
```typescript
// Unchanged - 'active' stays same
if (workflow.next_run_timestamp && workflow.status === "active") {
```

### 4. API Layer

#### `packages/db/src/api.ts`

**Update `createTask()`** - New workflows start as 'draft':
```typescript
const workflow: Workflow = {
  id: workflowId,
  task_id: taskId,
  chat_id: chatId,
  status: "draft",  // Explicit instead of ""
  // ... rest
};
```

## Implementation Checklist

### Database
- [ ] Create `v29.ts` migration to update existing status values
- [ ] Update `addWorkflow()` to default to 'draft'
- [ ] Update `getStaleWorkflows()` query to use 'draft'
- [ ] Update `getDraftActivitySummary()` query to use 'draft'

### Agent
- [ ] Update escalation in `workflow-worker.ts` to set 'error' instead of 'disabled'
- [ ] Update `save.ts` to transition 'draft' → 'ready' when first script saved

### UI
- [ ] Update `StatusBadge.tsx` with all 5 status values
- [ ] Update `WorkflowDetailPage.tsx`:
  - [ ] Activate button shows for 'ready'
  - [ ] Pause button sets 'paused'
  - [ ] Resume button shows for 'paused' AND 'error'
  - [ ] Draft hint shows for 'draft'
  - [ ] Run now shows for 'draft', 'ready', 'active' (with script)
- [ ] Verify `WorkflowEventGroup.tsx` still works
- [ ] Verify `MainPage.tsx` still works

### API
- [ ] Update `createTask()` to use 'draft' status

### Search & Replace (careful review needed)
- [ ] `status === ""` → `status === "draft"`
- [ ] `status === "disabled"` → `status === "paused"`
- [ ] `status: "disabled"` → `status: "paused"`
- [ ] `status: ""` → `status: "draft"`

## Testing

1. Fresh install: new workflows start as 'draft'
2. Existing data: migration converts '' to 'draft', 'disabled' to 'paused'
3. Existing data: drafts with scripts become 'ready'
4. Save first script: status transitions 'draft' → 'ready'
5. Activate workflow: status transitions 'ready' → 'active'
6. Pause workflow: status transitions 'active' → 'paused'
7. Resume workflow: status transitions 'paused' → 'active'
8. Auth error: status becomes 'error'
9. Escalated logic error: status becomes 'error' (not 'paused')
10. Resume from error: status transitions 'error' → 'active'
11. StatusBadge shows correct colors for all 5 states
12. No TypeScript errors
13. No console errors at runtime

## Notes

- `maintenance` boolean remains separate from status (orthogonal concerns)
- `maintenance_fix_count` naming unchanged
- The 'ready' state is explicit - set when first script saved, not derived
- 'error' status now covers both user-attention errors AND escalated auto-fix failures
- Resume from 'error' works same as resume from 'paused'
