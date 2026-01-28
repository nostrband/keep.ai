# Maintainer Task Type

## Overview

This spec introduces a new `maintainer` task type for bounded, autonomous script repair. The maintainer operates separately from the planner with restricted tools and limited scope.

## Background

### Current State
- Task types: `worker` (legacy, to be removed), `planner`
- Logic errors route to planner via inbox with `maintenanceRequest: true` metadata
- Planner handles both script creation AND maintenance fixes using same `save` tool
- Script version is single integer (1, 2, 3...)

### Target State (per docs/dev/04-runtime-planner-executor-maintainer.md)
- Three modes: Planner, Executor, Maintainer
- Maintainer is a "bounded repair capability"
- Maintainer does NOT decide control flow or escalation
- Maintainer output is untrusted input requiring validation
- Maintainer cannot modify intent, only propose backward-compatible fixes

## Changes

### 1. Task Type Enum

**File:** `packages/db/src/task-store.ts`

```typescript
// Before
export type TaskType = "worker" | "planner";

// After
export type TaskType = "worker" | "planner" | "maintainer";
```

### 2. Workflow Schema

**File:** `packages/db/src/script-store.ts`

No changes to workflow schema. Maintainer tasks are created per-failure and linked via `workflow_id` on the task, not via a workflow field.

Rationale:
- Each logic error spawns a fresh maintainer task
- No context leaks across maintenance attempts
- No drift from accumulated state
- Clean 1:1 mapping: one failure = one maintainer task
- Easy to display as separate auto-fix threads in UI

### 3. Script Version Schema

**File:** `packages/db/src/script-store.ts`

Replace single `version` with separate columns for lexicographic sorting:

```typescript
export interface Script {
  id: string;
  task_id: string;
  // Before: version: number;
  // After:
  major_version: number;        // Incremented by planner's save tool
  minor_version: number;        // Incremented by maintainer's fix tool
  timestamp: string;
  code: string;
  change_comment: string;
  workflow_id: string;
  type: string;
  summary: string;
  diagram: string;
}
```

**Helper function:**
```typescript
function formatVersion(major: number, minor: number): string {
  return `${major}.${minor}`;
}

function getLatestScript(workflowId: string): Promise<Script | null> {
  // ORDER BY major_version DESC, minor_version DESC LIMIT 1
}

function getLatestScriptForMajor(workflowId: string, major: number): Promise<Script | null> {
  // WHERE major_version = ? ORDER BY minor_version DESC LIMIT 1
}
```

**Migration:**
```sql
-- Rename old column
ALTER TABLE scripts RENAME COLUMN version TO major_version;
-- Add new column
ALTER TABLE scripts ADD COLUMN minor_version INTEGER DEFAULT 0;
```

### 4. Inbox Target Type

**File:** `packages/db/src/inbox-store.ts`

```typescript
// Before
export type InboxItemTarget = "worker" | "planner";

// After
export type InboxItemTarget = "worker" | "planner" | "maintainer";
```

### 5. Maintainer Task Creation (Per-Failure)

A new maintainer task is created for each logic error. This ensures:
- Clean context isolation between repair attempts
- No accumulated state or drift
- Clear auditability (1 failure = 1 maintainer task)
- Easy UI display as separate auto-fix threads

**File:** `packages/db/src/task-store.ts`

Encapsulate the entire maintenance mode entry as a single transactional method:

```typescript
export interface EnterMaintenanceModeParams {
  workflow: Workflow;
  scriptRun: ScriptRun;
}

export interface EnterMaintenanceModeResult {
  maintainerTask: Task;
  inboxItemId: string;
  newFixCount: number;
}

/**
 * Atomically:
 * 1. Increment workflow.maintenance_fix_count
 * 2. Set workflow.maintenance = true
 * 3. Create maintainer task
 * 4. Create inbox item targeting the task
 *
 * All operations succeed or fail together.
 */
export async function enterMaintenanceMode(
  params: EnterMaintenanceModeParams
): Promise<EnterMaintenanceModeResult> {
  const { workflow, scriptRun } = params;

  return db.transaction(async (tx) => {
    // 1. Increment fix count
    const newFixCount = await incrementMaintenanceFixCount(workflow.id, tx);

    // 2. Set maintenance flag
    await setWorkflowMaintenance(workflow.id, true, tx);

    // 3. Create maintainer task
    const maintainerTask = await createTask({
      id: generateId(),
      type: "maintainer",
      workflow_id: workflow.id,
      chat_id: "",  // Maintainer does NOT write to user-facing chat
      title: `Auto-fix: ${workflow.title}`,
      thread_id: generateId(),
    }, tx);

    // 4. Create inbox item
    const inboxItemId = `maintenance.${workflow.id}.${scriptRun.id}.${generateId()}`;
    await saveInbox({
      id: inboxItemId,
      source: "script",
      source_id: scriptRun.id,
      target: "maintainer",
      target_id: maintainerTask.id,
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        role: "user",
        parts: [{
          type: "text",
          text: "A logic error occurred. Analyze and fix the script.",
        }],
        metadata: {
          scriptRunId: scriptRun.id,
        },
      }),
      handler_thread_id: "",
      handler_timestamp: "",
    }, tx);

    return { maintainerTask, inboxItemId, newFixCount };
  });
}

// Query all maintainer tasks for a workflow (for UI display)
export async function getMaintainerTasksForWorkflow(workflowId: string): Promise<Task[]> {
  // SELECT * FROM tasks WHERE workflow_id = ? AND type = 'maintainer' ORDER BY timestamp DESC
  return getTasksByWorkflowAndType(workflowId, "maintainer");
}
```

### 6. Logic Error Routing

Change from routing to planner to routing to maintainer.

**File:** `packages/agent/src/workflow-worker.ts`

```typescript
private async handleLogicError(
  workflow: Workflow,
  script: Script,
  scriptRun: ScriptRun,
  error: ClassifiedError,
): Promise<void> {
  // Check fix attempt budget BEFORE entering maintenance
  const currentFixCount = workflow.maintenance_fix_count || 0;
  if (currentFixCount >= MAX_FIX_ATTEMPTS) {
    await this.escalateToUser(workflow, script, scriptRun, error, currentFixCount);
    return;
  }

  // Single atomic call - all DB operations handled in taskStore
  const result = await taskStore.enterMaintenanceMode({
    workflow,
    scriptRun,
  });

  // Log for observability
  console.log(`Entered maintenance mode for workflow ${workflow.id}, ` +
    `maintainer task ${result.maintainerTask.id}, ` +
    `fix attempt ${result.newFixCount}/${MAX_FIX_ATTEMPTS}`);
}
```

### 7. Maintainer Context Loading

Maintainer reconstructs full context from `script_run_id`.

**File:** `packages/agent/src/task-worker.ts`

```typescript
interface MaintainerContext {
  scriptRunId: string;
  error: {
    type: string;
    message: string;
    stack: string;
  };
  logs: string;
  result: unknown;
  scriptCode: string;
  scriptVersion: string;
  workflowId: string;
  currentMajorVersion: number;
  changelog: Array<{ version: string; comment: string }>;
}

private async loadMaintainerContext(scriptRunId: string): Promise<MaintainerContext> {
  const scriptRun = await scriptStore.getScriptRun(scriptRunId);
  const script = await scriptStore.getScript(scriptRun.script_id);
  const workflow = await scriptStore.getWorkflow(scriptRun.workflow_id);

  // Get all prior minor versions for the same major version
  // e.g., for 2.3 → include 2.2, 2.1, 2.0
  const priorScripts = await scriptStore.getScriptsByWorkflowAndMajorVersion(
    workflow.id,
    script.major_version,
  );
  const changelog = priorScripts
    .filter(s => s.minor_version < script.minor_version)
    .sort((a, b) => b.minor_version - a.minor_version) // newest first
    .map(s => ({
      version: formatVersion(s.major_version, s.minor_version),
      comment: s.change_comment,
    }));

  return {
    scriptRunId,
    error: {
      type: scriptRun.error_type,
      message: scriptRun.error_message,
      stack: scriptRun.error_stack,
    },
    logs: scriptRun.logs,
    result: scriptRun.result,
    scriptCode: script.code,
    scriptVersion: formatVersion(script.major_version, script.minor_version),
    workflowId: workflow.id,
    currentMajorVersion: script.major_version,
    changelog,
  };
}
```

**Helper in script-store:**

```typescript
export async function getScriptsByWorkflowAndMajorVersion(
  workflowId: string,
  majorVersion: number,
): Promise<Script[]> {
  // SELECT * FROM scripts WHERE workflow_id = ? AND major_version = ? ORDER BY minor_version DESC
  return db.query(/* ... */);
}
```

### 8. Maintainer Tools Configuration

Maintainer has restricted tool set.

**File:** `packages/agent/src/task-worker.ts` (or new config file)

```typescript
const MAINTAINER_EXCLUDED_TOOLS = ['save', 'ask', 'schedule'];

function getMaintainerTools(allTools: Tool[]): Tool[] {
  return allTools.filter(t => !MAINTAINER_EXCLUDED_TOOLS.includes(t.name));
}
```

Maintainer gets:
- `fix` tool (new, see below)
- Sandbox/eval access
- Read-only tools (web-fetch, web-search, etc.)
- All other tools except save/ask/schedule

### 9. Fix Tool

New tool for maintainer to propose code fixes.

**File:** `packages/agent/src/ai-tools/fix.ts`

```typescript
export interface FixInfo {
  code: string;           // New script code
  comment: string;        // Brief description of the fix
}

export interface FixResult {
  script: Script;
  applied: boolean;       // False if planner updated script while maintainer was running
}

export async function execute(info: FixInfo, opts: FixToolOptions): Promise<FixResult> {
  const workflow = await scriptStore.getWorkflow(opts.workflowId);
  const currentScript = await scriptStore.getScript(workflow.active_script_id);

  // Race condition check: only apply fix if planner hasn't updated
  // Maintainer was working on major version X, if current is still X, we can proceed
  if (currentScript.major_version !== opts.expectedMajorVersion) {
    // Planner updated the script while maintainer was running
    // Our fix is stale - don't apply it
    return {
      script: currentScript,
      applied: false,
    };
  }

  // Increment minor version
  const newScript = await scriptStore.createScript({
    id: generateId(),
    task_id: opts.maintainerTaskId,
    major_version: currentScript.major_version,
    minor_version: currentScript.minor_version + 1,
    code: info.code,
    change_comment: info.comment,
    workflow_id: workflow.id,
    // Preserve existing metadata - maintainer cannot change these
    summary: currentScript.summary,
    diagram: currentScript.diagram,
    type: currentScript.type,
    timestamp: new Date().toISOString(),
  });

  // Update workflow
  await scriptStore.updateWorkflowFields(workflow.id, {
    active_script_id: newScript.id,
    maintenance: false,
    next_run_timestamp: new Date().toISOString(),  // Trigger immediate re-run
  });

  // Reset fix count on successful fix application
  // (Will be reset again if re-run succeeds)

  return { script: newScript, applied: true };
}
```

**Tool definition:**
```typescript
export const fixTool = tool({
  name: "fix",
  description: `Propose a fix for the script error.
This tool can ONLY modify the script code - it cannot change title, summary, schedule, or other metadata.
Call this tool when you have identified and fixed the bug in the script.
If you cannot fix the issue, do NOT call this tool - provide an explanation instead.`,
  parameters: z.object({
    code: z.string().describe("The complete fixed script code"),
    comment: z.string().describe("Brief description of what was fixed"),
  }),
  execute: async (info, opts) => execute(info, opts),
});
```

### 10. Save Tool Updates

Update save tool to increment major version and reset minor.

**File:** `packages/agent/src/ai-tools/save.ts`

```typescript
export async function execute(info: SaveInfo): Promise<SaveResult> {
  const workflow = await scriptStore.getWorkflowByTaskId(opts.taskId);
  const currentScript = await scriptStore.getLatestScriptByWorkflowId(workflow.id);

  // Determine new version
  let majorVersion: number;
  let minorVersion: number;

  if (currentScript) {
    // Increment major, reset minor
    majorVersion = currentScript.major_version + 1;
    minorVersion = 0;
  } else {
    // First script
    majorVersion = 1;
    minorVersion = 0;
  }

  const newScript = await scriptStore.createScript({
    id: generateId(),
    task_id: opts.taskId,
    major_version: majorVersion,
    minor_version: minorVersion,
    code: info.code,
    change_comment: info.comments,
    summary: info.summary,
    diagram: info.diagram,
    workflow_id: workflow.id,
    type: "",
    timestamp: new Date().toISOString(),
  });

  // ... rest of save logic
}
```

### 11. Task Scheduler Priority

Planner tasks run before maintainer tasks for the same workflow.

**File:** `packages/agent/src/task-scheduler.ts`

```typescript
private async processNextTask(inboxItems: InboxItem[]): Promise<boolean> {
  // ... existing filtering logic ...

  // Group by workflow to detect conflicts
  const itemsByWorkflow = groupBy(filteredItems, item => {
    // Extract workflow_id from inbox item metadata or target task
    return this.getWorkflowIdForInboxItem(item);
  });

  // For each workflow, prioritize planner over maintainer
  for (const [workflowId, items] of Object.entries(itemsByWorkflow)) {
    const plannerItems = items.filter(i => i.target === 'planner');
    const maintainerItems = items.filter(i => i.target === 'maintainer');

    // If both planner and maintainer have pending work for same workflow,
    // only process planner - maintainer must wait
    if (plannerItems.length > 0 && maintainerItems.length > 0) {
      // Remove maintainer items from this round
      filteredItems = filteredItems.filter(i =>
        !(i.target === 'maintainer' && this.getWorkflowIdForInboxItem(i) === workflowId)
      );
    }
  }

  // ... continue with existing logic to pick next task ...
}
```

### 12. Maintainer Escalation

If maintainer completes without calling `fix`, escalate with explanation.

**File:** `packages/agent/src/task-worker.ts`

```typescript
private async handleMaintainerCompletion(
  task: Task,
  result: AgentLoopResult,
  context: MaintainerContext,
): Promise<void> {
  const fixCalled = this.checkIfFixToolCalled(result);

  if (fixCalled) {
    // Fix was applied (or rejected due to race condition)
    // Check if it was actually applied
    const fixResult = this.getFixToolResult(result);
    if (!fixResult.applied) {
      // Race condition - planner updated while maintainer was running
      // Clear maintenance mode, don't escalate - the new planner script will run
      await scriptStore.updateWorkflowFields(context.workflowId, {
        maintenance: false,
      });
      return;
    }
    // Fix applied successfully - workflow will re-run
    return;
  }

  // Fix was NOT called - maintainer couldn't fix it
  // Escalate to user with maintainer's explanation
  const explanation = this.getLastAssistantMessage(result);

  await this.escalateWithExplanation(
    context.workflowId,
    context.scriptRunId,
    explanation,
  );
}

private async escalateWithExplanation(
  workflowId: string,
  scriptRunId: string,
  explanation: string,
): Promise<void> {
  const workflow = await scriptStore.getWorkflow(workflowId);

  // Set workflow to error status
  await scriptStore.updateWorkflowFields(workflowId, {
    status: "error",
    maintenance: false,
    maintenance_fix_count: 0,
  });

  // Create notification with explanation and Re-plan action
  await notificationStore.saveNotification({
    id: generateId(),
    workflow_id: workflowId,
    type: 'maintenance_failed',
    timestamp: new Date().toISOString(),
    payload: {
      script_run_id: scriptRunId,
      explanation: explanation,
      actions: [
        {
          type: 'replan',
          label: 'Re-plan',
          // Opens workflow's chat to discuss the issue with planner
          target: `/workflow/${workflowId}/chat`,
        }
      ],
    },
    acknowledged_at: null,
  });

  this.emitSignal({
    type: "needs_attention",
    workflowId: workflowId,
    error: "Auto-fix failed - manual intervention required",
  });
}
```

### 13. Maintainer Thread (Agentic Session)

Maintainer has its own thread, does NOT write to user-facing chat.

**File:** `packages/agent/src/task-worker.ts`

```typescript
// When executing maintainer task:
if (task.type === 'maintainer') {
  // Maintainer uses its own thread, not linked to any chat_id
  // Messages are stored for debugging but not shown in user chat
  const threadId = task.thread_id || generateId();

  // ... run agent loop with threadId ...

  // No chat messages posted - only events/notifications on escalation
}
```

## Race Condition Handling

### Problem
Planner and maintainer could both try to update `active_script_id`:
1. Script v1.0 fails with logic error
2. Maintainer starts working on fix
3. User modifies intent, planner creates v2.0
4. Maintainer completes with fix for v1.0

### Solution
1. **Scheduler prevents concurrent execution** for same workflow (planner prioritized)
2. **Fix tool checks major version** before applying
3. **If stale, fix is discarded** - v2.0 from planner takes precedence

### TODO/FIXME
```typescript
// FIXME: Mutation reconciliation when maintainer's fix is discarded
// If maintainer ran expensive operations (API calls, etc.) before fix was rejected,
// those side effects have already occurred. Need to consider:
// 1. Should maintainer do dry-run validation before any side effects?
// 2. How to handle partial state from rejected fix attempt?
// 3. Should we track "attempted but rejected" fixes for debugging?
// See docs/dev/09-failure-repair.md section on "Reconciliation of side effects"
```

## UI Considerations

### Auto-fix Display
- Auto-fixes are NOT shown in user-facing chat
- Each maintainer task is displayed as a separate auto-fix thread in UI
- Query via `getMaintainerTasksForWorkflow(workflowId)`
- Shows: version change (1.0 → 1.1), fix comment, timestamp, full thread history for debugging

### Notifications
- `maintenance_failed` notification includes:
  - Maintainer's explanation of why fix wasn't possible
  - "Re-plan" action leading to workflow chat
  - Link to failed run for debugging

## Files to Modify

1. `packages/db/src/task-store.ts` - TaskType enum, `enterMaintenanceMode()` transactional method, `getMaintainerTasksForWorkflow()`
2. `packages/db/src/script-store.ts` - Script schema (version columns), version helpers
3. `packages/db/src/inbox-store.ts` - InboxItemTarget type
4. `packages/agent/src/workflow-worker.ts` - Logic error routing, maintainer task creation
5. `packages/agent/src/task-worker.ts` - Maintainer context loading, tool config, completion handling, task type detection
6. `packages/agent/src/task-scheduler.ts` - Priority handling
7. `packages/agent/src/ai-tools/save.ts` - Major version increment
8. `packages/agent/src/ai-tools/fix.ts` - NEW FILE
9. `packages/db/migrations/` - Schema migrations

## Maintainer System Prompt

**File:** `packages/agent/src/agent-env.ts`

Add case for `maintainer` in `buildSystem()` and `temperature` getter:

```typescript
get temperature() {
  switch (this.type) {
    case "worker":
    case "planner":
    case "maintainer":
      return 0.1;
  }
}

async buildSystem(): Promise<string> {
  let systemPrompt = "";
  switch (this.type) {
    case "worker": {
      systemPrompt = this.workerSystemPrompt();
      break;
    }
    case "planner": {
      systemPrompt = this.plannerSystemPrompt();
      break;
    }
    case "maintainer": {
      systemPrompt = this.maintainerSystemPrompt();
      break;
    }
  }
  // ...
}
```

**System prompt method:**

```typescript
private maintainerSystemPrompt() {
  return `
You are an autonomous JS script repair agent. Your role is strictly bounded: analyze a script failure and propose a backward-compatible fix.

## Your Role

You are a bounded repair capability. Given:
- The failed script code
- Concrete failure evidence (error, logs, result)
- The original intent (via script structure and comments)

Your job: propose a fix that makes the script work while preserving its original behavior and intent, and being backward-compatible with the output and side-effects produced.

## What You Receive

You will be given:
- \`scriptCode\`: The current script that failed
- \`scriptVersion\`: The version (e.g., "2.1")
- \`error\`: Error type, message, and stack trace
- \`logs\`: Console output from the failed run
- \`result\`: Any partial result before failure

User is not available, you are autonomous and cannot ask questions, you must handle the task yourself with provided input and tools.

## Available Tools

You have access to:
- \`fix\`: Propose a fixed script (your primary output tool)
- \`eval\`: Test code in sandbox to understand the failure and validate your fix
- Various JS APIs available inside the sandbox

## How to Proceed

1. **Analyze the failure**
   - Study the error message and stack trace carefully
   - Review the logs to understand what happened before the failure
   - Identify the root cause (API change, edge case, data format issue, etc.)

2. **Use \`eval\` to investigate**
   - Test hypotheses about what went wrong
   - Validate that your understanding of the failure is correct
   - Prototype your fix before committing

3. **Propose a fix using the \`fix\` tool**
   - Provide the complete fixed script code
   - Include a brief comment explaining what you fixed
   - The fix MUST be backward-compatible (same input formats → same output formats)
   - Do NOT change the script's purpose or add new features

## Constraints on Your Fix

Your fix MUST:
- Preserve the original intent and behavior
- Handle the specific failure case without breaking other cases
- Be minimal - fix only what's broken
- Maintain all existing functionality

Your fix MUST NOT:
- Change what the script does (only how it does it)
- Add new features or capabilities
- Modify schedules, triggers, or metadata
- Relax error handling in ways that hide problems
- Change output and side-effect data formats

## If You Cannot Fix It

If the failure requires changes beyond your scope or constraints (e.g., intent clarification, new permissions, fundamental redesign), do NOT call the \`fix\` tool.

Instead, provide a clear explanation of:
- What the failure is
- Why you cannot fix it autonomously

This explanation will be shown to the user with an option to interactively re-plan the automation.

${this.jsPrompt([])}

${this.filesPrompt()}

## Time & locale
- Use the provided 'Timestamp: <iso datetime>' from the last message as current time.
${this.localePrompt()}
`;
}
```

**Key differences from planner prompt:**

| Aspect | Planner | Maintainer |
|--------|---------|------------|
| Role | Create/update automations | Fix specific failures |
| User interaction | Can ask questions | Cannot ask questions |
| Output tools | `save`, `schedule`, `ask` | `fix` only |
| Scope | Full creative freedom | Backward-compatible fixes only |
| Metadata changes | Can modify all | Cannot modify any |
| Failure handling | N/A | Must explain if cannot fix |

## Out of Scope

- Automatic backward-compatibility validation for `fix` tool (prompting guidance only for now)
- Other tool/js-api revisions
- Removing `worker` task type (separate effort)
