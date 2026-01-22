# Spec 10: Tasks Table Cleanup and task_states Removal

## Overview

Simplify the tasks system by:
1. Adding `workflow_id` and `asks` to tasks table
2. Deprecating the entire `task_states` table
3. Removing goal/notes/plan fields from agent context and task_runs
4. Deprecating unused fields in tasks table

## Changes Summary

### tasks table
- **Deprecate:** `task`, `cron` (already unused, mark in migration)
- **Add:** `workflow_id` (TEXT, indexed, set at creation, immutable)
- **Add:** `asks` (TEXT, moved from task_states)

### task_states table
- **Deprecate:** Entire table (keep in DB, remove all code)

### task_runs table
- **Deprecate:** `input_goal`, `input_notes`, `input_plan`, `input_asks`, `output_goal`, `output_notes`, `output_plan`, `output_asks`

### Agent context
- **Remove:** `===TASK_GOAL===`, `===TASK_PLAN===`, `===TASK_ASKS===`, `===TASK_NOTES===` sections

## Database Migration (v28)

```sql
-- Add workflow_id to tasks
ALTER TABLE tasks ADD COLUMN workflow_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id);

-- Add asks to tasks (moved from task_states)
ALTER TABLE tasks ADD COLUMN asks TEXT NOT NULL DEFAULT '';

-- Populate workflow_id from existing workflows
UPDATE tasks
SET workflow_id = (
  SELECT w.id FROM workflows w WHERE w.task_id = tasks.id
)
WHERE workflow_id = '';

-- Populate asks from task_states
UPDATE tasks
SET asks = COALESCE(
  (SELECT ts.asks FROM task_states ts WHERE ts.id = tasks.id),
  ''
)
WHERE asks = '';
```

**File:** `packages/db/src/migrations/v28.ts`

### Deprecation Comments

**v1.ts** - tasks table:
```typescript
// DEPRECATED fields (kept for backwards compatibility, not used in code):
// - task: legacy field, never used
// - cron: workflows have their own cron field now
// See Spec 10.
```

**v5.ts** - task_states table:
```typescript
// DEPRECATED: task_states table is no longer used.
// The 'asks' field has been moved to the tasks table.
// Fields goal, notes, plan have been removed entirely.
// See Spec 10.
```

**v6.ts** - task_runs table:
```typescript
// DEPRECATED fields (kept for backwards compatibility, not used in code):
// - input_goal, input_notes, input_plan, input_asks
// - output_goal, output_notes, output_plan, output_asks
// - reason (only "input" value was left, now unused)
// See Spec 10.
```

## Files to Modify

### 1. Database Layer

#### `packages/db/src/migrations/v28.ts` (NEW)
Create migration with new columns, indexes, and data migration.

#### `packages/db/src/task-store.ts`

**Update Task type:**
```typescript
// Before
export interface Task {
  id: string;
  timestamp: number;
  task?: string;      // REMOVE
  reply: string;
  state: string;
  thread_id: string;
  error: string;
  deleted?: boolean;
  type: string;
  title: string;
  cron?: string;      // REMOVE
  chat_id: string;
}

// After
export interface Task {
  id: string;
  timestamp: number;
  reply: string;
  state: string;
  thread_id: string;
  error: string;
  deleted?: boolean;
  type: string;
  title: string;
  chat_id: string;
  workflow_id: string;  // NEW
  asks: string;         // NEW (moved from task_states)
}
```

**Remove TaskState type entirely** (lines ~20-26)

**Update `addTask()`:**
- Add `workflow_id` and `asks` to INSERT
- Remove `task` and `cron` from INSERT

**Update `getTask()`, `getTasks()`, `getTaskByChatId()`, `listTasks()`:**
- Add `workflow_id` and `asks` to SELECT
- Remove `task` and `cron` from SELECT and mapping

**Add new method:**
```typescript
async getTaskByWorkflowId(workflowId: string): Promise<Task | null>
```

**Add new method:**
```typescript
async updateTaskAsks(taskId: string, asks: string): Promise<void> {
  await this.db.db.exec(
    `UPDATE tasks SET asks = ? WHERE id = ?`,
    [asks, taskId]
  );
}
```

**Remove methods entirely:**
- `saveState()` (lines ~335-347)
- `getState()` (lines ~350-370)
- `getStates()` (lines ~373-397)

#### `packages/db/src/script-store.ts`

**Update TaskRun type:**
```typescript
// Before
export interface TaskRun {
  id: string;
  task_id: string;
  type: string;
  start_timestamp: string;
  thread_id: string;
  reason: string;           // REMOVE
  inbox: string;
  model: string;
  input_goal: string;       // REMOVE
  input_notes: string;      // REMOVE
  input_plan: string;       // REMOVE
  input_asks: string;       // REMOVE
  output_goal: string;      // REMOVE
  output_notes: string;     // REMOVE
  output_plan: string;      // REMOVE
  output_asks: string;      // REMOVE
  end_timestamp: string;
  state: string;
  reply: string;
  error: string;
  steps: number;
  run_sec: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  logs: string;
}

// After
export interface TaskRun {
  id: string;
  task_id: string;
  type: string;
  start_timestamp: string;
  thread_id: string;
  inbox: string;
  model: string;
  end_timestamp: string;
  state: string;
  reply: string;
  error: string;
  steps: number;
  run_sec: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  logs: string;
}
```

**Update `addTaskRun()`:**
- Remove deprecated fields from INSERT
- Keep writing empty strings to DB columns for compatibility

**Update `getTaskRun()`, `getTaskRuns()`, `listTaskRuns()`:**
- Remove deprecated fields from SELECT and mapping

#### `packages/db/src/api.ts`

**Update `createTask()`:**
```typescript
// Add workflowId parameter or generate it here
const task: Task = {
  id: taskId,
  timestamp: Math.floor(Date.now() / 1000),
  reply: "",
  state: "",
  thread_id: "",
  error: "",
  type: "planner",
  title: "",
  chat_id: chatId,
  workflow_id: workflowId,  // NEW: set at creation
  asks: "",                  // NEW: initialized empty
};
```

### 2. Agent Code

#### `packages/agent/src/agent-types.ts`

**Remove TaskState type** (lines ~7-12):
```typescript
// REMOVE THIS ENTIRE TYPE
export type TaskState = {
  goal?: string;
  notes?: string;
  plan?: string;
  asks?: string;
};
```

#### `packages/agent/src/agent-env.ts`

**Remove task state context injection** (lines ~106-113):
```typescript
// REMOVE THIS ENTIRE BLOCK
if (state.goal) taskInfo.push(...["===TASK_GOAL===", state.goal]);
if (state.plan) taskInfo.push(...["===TASK_PLAN===", state.plan]);
if (state.asks) taskInfo.push(...["===TASK_ASKS===", state.asks]);
if (state.notes) taskInfo.push(...["===TASK_NOTES===", state.notes]);
```

**Update function signature to not require state parameter** or simplify.

#### `packages/agent/src/task-worker.ts`

**Remove `getTaskState()` method** (lines ~653-663)

**Remove state loading and saving logic:**
- Remove: `const state = await this.getTaskState(task);`
- Remove: `await this.api.taskStore.saveState(state);`
- Remove: State patch application (lines ~250-259)

**Update asks handling:**
```typescript
// Before
if (result.patch.asks !== undefined) state.asks = result.patch.asks;
await this.api.taskStore.saveState(state);

// After
if (result.patch.asks !== undefined) {
  await this.api.taskStore.updateTaskAsks(task.id, result.patch.asks);
}
```

**Update sendToUser call:**
```typescript
// Before
if (result.kind === "wait" && state.asks) {
  await this.sendToUser(task.chat_id, state.asks);
}

// After
if (result.kind === "wait" && task.asks) {
  await this.sendToUser(task.chat_id, task.asks);
}
```

**Remove state from debug logging:**
```typescript
// Before
this.debug(`Task updated`, { id: task.id, threadId: task.thread_id, asks: state?.asks });

// After
this.debug(`Task updated`, { id: task.id, threadId: task.thread_id });
```

#### `packages/agent/src/agent.ts`

**Update ask tool setup** (lines ~187-200):
- Remove `notes` and `plan` from patch
- Only keep `asks` in patch

```typescript
// Before
patch: {
  notes: info.notes,
  plan: info.plan,
  asks: info.formattedAsks,
}

// After
patch: {
  asks: info.formattedAsks,
}
```

#### `packages/agent/src/ai-tools/ask.ts`

**Simplify to only handle asks:**
- Remove `notes` and `plan` parameters
- Keep only `asks` and `options` formatting

#### `packages/agent/src/ai-tools/finish.ts`

**Remove state-related parameters:**
- Remove `notes` and `plan` from finish tool if present

#### `packages/agent/src/tools/add-task.ts`

**Remove saveState call** (lines ~33-39):
```typescript
// REMOVE THIS ENTIRE BLOCK
await taskStore.saveState({
  id,
  goal: opts.goal || "",
  notes: opts.notes || "",
  asks: "",
  plan: "",
});
```

**Remove goal/notes from tool parameters if present.**

#### `packages/agent/src/tools/get-task.ts`

**Remove state fields from response** (lines ~15-18):
```typescript
// Before
return {
  ...task,
  goal: state?.goal || "",
  notes: state?.notes || "",
  plan: state?.plan || "",
  asks: state?.asks || "",
};

// After
return task;  // task now has asks field directly
```

**Remove getState call.**

#### `packages/agent/src/tools/list-tasks.ts`

**Remove state fields from response** (lines ~21-26):
```typescript
// Before
return tasks.map(task => ({
  ...task,
  goal: stateMap[task.id]?.goal || "",
  notes: stateMap[task.id]?.notes || "",
  plan: stateMap[task.id]?.plan || "",
  asks: stateMap[task.id]?.asks || "",
}));

// After
return tasks;  // tasks now have asks field directly
```

**Remove getStates call.**

#### `packages/agent/src/tools/list-events.ts`

**Remove state lookup if present** (line ~36).

### 3. UI Components

#### `apps/web/src/components/TaskDetailPage.tsx`

**Remove task state display sections** (lines ~169-207):
```typescript
// REMOVE: Goal display section
{taskState.goal && (
  <div>
    <h3>Goal</h3>
    <Response>{taskState.goal}</Response>
  </div>
)}

// REMOVE: Notes display section
{taskState.notes && (...)}

// REMOVE: Plan display section
{taskState.plan && (...)}

// REMOVE: Asks display section (or update to use task.asks)
{taskState.asks && (...)}
```

**Remove `useTaskState` hook usage:**
```typescript
// Before
const { data: taskState } = useTaskState(id!);

// After
// Remove this hook, use task.asks directly if needed
```

#### `apps/web/src/components/TaskRunDetailPage.tsx`

**Remove input/output state sections** (lines ~184-226, ~250-292):
```typescript
// REMOVE: input_goal, input_notes, input_plan, input_asks displays
// REMOVE: output_goal, output_notes, output_plan, output_asks displays
```

#### `apps/web/src/components/ChatPage.tsx`

**Update asks access** (lines ~47-50):
```typescript
// Before
const { data: taskState } = useTaskState(task?.id || "");
const parsed = parseAsks(taskState?.asks || "");

// After
const parsed = parseAsks(task?.asks || "");
```

**Remove `useTaskState` hook import and usage.**

### 4. React Hooks

#### `apps/web/src/hooks/dbTaskReads.ts`

**Remove `useTaskState` hook entirely** (lines ~38-54):
```typescript
// REMOVE THIS ENTIRE HOOK
export function useTaskState(taskId: string) {
  // ...
}
```

**Add new hook:**
```typescript
export function useTaskByWorkflowId(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.taskByWorkflowId(workflowId),
    queryFn: async () => {
      if (!api || !workflowId) return null;
      return api.taskStore.getTaskByWorkflowId(workflowId);
    },
    meta: { tables: ["tasks"] },
    enabled: !!api && !!workflowId,
  });
}
```

#### `apps/web/src/hooks/queryKeys.ts`

**Remove:**
```typescript
taskState: (taskId: string) => ["taskState", taskId],
```

**Add:**
```typescript
taskByWorkflowId: (workflowId: string) => ["taskByWorkflowId", workflowId],
```

### 5. Package Exports

#### `packages/db/src/index.ts`

**Remove TaskState export if present.**

## Implementation Checklist

### Database
- [ ] Create `v28.ts` migration with new columns, indexes, and data migration
- [ ] Add deprecation comments to `v1.ts` (tasks.task, tasks.cron)
- [ ] Add deprecation comments to `v5.ts` (entire task_states table)
- [ ] Add deprecation comments to `v6.ts` (task_runs state fields)
- [ ] Update `Task` type - add `workflow_id`, `asks`, remove `task`, `cron`
- [ ] Update `TaskRun` type - remove all input_*/output_* state fields, remove `reason`
- [ ] Update `addTask()` with new fields
- [ ] Update `getTask()`, `getTasks()`, `getTaskByChatId()`, `listTasks()` with new fields
- [ ] Add `getTaskByWorkflowId()` method
- [ ] Add `updateTaskAsks()` method
- [ ] Remove `saveState()`, `getState()`, `getStates()` methods
- [ ] Update `addTaskRun()` to stop writing deprecated fields
- [ ] Update `getTaskRun()`, `getTaskRuns()` to stop reading deprecated fields

### API
- [ ] Update `createTask()` to set `workflow_id` at creation

### Agent
- [ ] Remove `TaskState` type from `agent-types.ts`
- [ ] Remove task state context injection from `agent-env.ts`
- [ ] Remove `getTaskState()` from `task-worker.ts`
- [ ] Update `task-worker.ts` to use `task.asks` and `updateTaskAsks()`
- [ ] Simplify ask tool in `agent.ts` - only `asks` in patch
- [ ] Simplify `ask.ts` tool - remove notes/plan
- [ ] Update `finish.ts` if it uses state fields
- [ ] Update `add-task.ts` - remove saveState call, remove goal/notes params
- [ ] Update `get-task.ts` - remove state lookup
- [ ] Update `list-tasks.ts` - remove state lookup
- [ ] Update `list-events.ts` - remove state lookup if present

### UI
- [ ] Update `TaskDetailPage.tsx` - remove goal/notes/plan/asks sections
- [ ] Update `TaskRunDetailPage.tsx` - remove input_*/output_* displays
- [ ] Update `ChatPage.tsx` - use `task.asks` instead of `taskState.asks`
- [ ] Remove `useTaskState` hook from `dbTaskReads.ts`
- [ ] Add `useTaskByWorkflowId` hook
- [ ] Update query keys

### Cleanup
- [ ] Remove all imports of `TaskState` type
- [ ] Remove all imports of `useTaskState` hook
- [ ] Search for any remaining references to task_states

## Testing

1. Fresh install: verify migration creates columns correctly
2. Existing data: verify asks migrated from task_states to tasks
3. Existing data: verify workflow_id populated from workflows
4. Create new task: verify `workflow_id` and `asks` set correctly
5. Agent ask tool: verify asks saved to tasks.asks
6. ChatPage: verify quick-reply buttons still work with task.asks
7. No TypeScript errors
8. No console errors at runtime

## Notes

- SQLite cannot drop columns, so deprecated fields remain in schema
- task_states table remains for backwards compatibility with existing DBs
- The asks field format (plain string or JSON with options) is unchanged
- task.workflow_id is immutable after creation (like chat_id)
- goal, notes, plan are completely removed from the application logic
