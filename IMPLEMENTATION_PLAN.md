# Implementation Plan

This document tracks the implementation progress for the Keep.ai automation platform.

---

## Priority 1: Maintainer Task Type (In Progress)

**Spec:** [specs/maintainer-task-type.md](specs/maintainer-task-type.md)

Introduces a new `maintainer` task type for bounded, autonomous script repair. The maintainer operates separately from the planner with restricted tools and limited scope.

### Database Layer (`packages/db`)

#### Completed
- [x] **Workflow maintenance infrastructure** - `maintenance` boolean, `maintenance_fix_count` column on workflow table
- [x] **setWorkflowMaintenance()** - Method to set maintenance flag
- [x] **incrementMaintenanceFixCount()** - Method to increment fix count
- [x] **resetMaintenanceFixCount()** - Method to reset fix count
- [x] **updateWorkflowFields()** - Atomic update method for workflow fields
- [x] **Migration: Script version schema** - Created migration v34 to rename `version` to `major_version` and add `minor_version` column with default 0
- [x] **Script interface update** - Updated `Script` interface in `script-store.ts` to use `major_version: number` and `minor_version: number`
- [x] **Update script queries** - Updated all queries that reference `version` to use `major_version` (ORDER BY, MAX, etc.)
- [x] **Version helper functions** - Added `formatVersion(major, minor)`, `getLatestScriptForMajor(workflowId, major)`, `getScriptsByWorkflowAndMajorVersion(workflowId, major)` functions
- [x] **TaskType enum** - Added `"maintainer"` to `TaskType = "worker" | "planner" | "maintainer"` in `task-store.ts`
- [x] **InboxItemTarget type** - Added `"maintainer"` to `InboxItemTarget = "worker" | "planner" | "maintainer"` in `inbox-store.ts`
- [x] **getMaintainerTasksForWorkflow** - Added query method to get all maintainer tasks for a workflow (for UI display)
- [x] **EnterMaintenanceModeParams/Result interfaces** - Added interfaces for enterMaintenanceMode transaction parameters and result
- [x] **enterMaintenanceMode transaction** - Transactional method in `KeepDbApi` (api.ts) that atomically: increments `maintenance_fix_count`, sets `maintenance = true`, creates maintainer task (with empty `chat_id`, own `thread_id`), creates inbox item targeting the task. Exported from index.ts.

### Agent Layer (`packages/agent`)

#### Logic Error Routing (Partially Complete)

##### Completed
- [x] **enterMaintenanceMode() method** - Logic error routing via enterMaintenanceMode() in `workflow-worker.ts` (NOTE: currently routes to planner inbox, not maintainer)
- [x] **Budget check before maintenance** - Check `maintenance_fix_count >= MAX_FIX_ATTEMPTS` before entering maintenance
- [x] **Escalation to user** - escalateToUser() exists with proper notification creation
- [x] **Save tool maintenance detection** - Save tool detects maintenance mode and clears flag

##### Completed
- [x] **Update workflow-worker.ts enterMaintenanceMode** - Refactored to call `api.enterMaintenanceMode()` which atomically creates maintainer task (routes to maintainer instead of planner)

#### Task Worker

- [x] **Support maintainer task type** - Added `"maintainer"` to type check in `task-worker.ts` executeTask method
- [x] **MaintainerContext interface** - Basic interface with `workflowId` and `expectedMajorVersion` for fix tool race condition check (in agent-types.ts)
- [x] **loadMaintainerContext** - Basic loading in task-worker.ts before creating agentTask (loads workflow and script to get major version)
- [x] **getMaintainerTools** - Tool filtering in agent.ts: maintainer gets `fix` tool, others get `save`/`ask`/`schedule`
- [x] **Maintainer completion handling** - Implement `handleMaintainerCompletion`: check if `fix` tool was called, handle race condition (fix not applied), escalate with explanation if no fix called
- [x] **Rich MaintainerContext** - Extend context with `scriptRunId`, `error`, `logs`, `result`, `scriptCode`, `scriptVersion`, `changelog` for system prompt injection

#### Task Scheduler

- [x] **Planner priority over maintainer** - Update `task-scheduler.ts` to prioritize planner tasks over maintainer tasks for the same workflow (group by workflow, filter out maintainer if planner exists). Basic planner-first exists but no per-workflow conflict resolution.
- [x] **getWorkflowIdForInboxItem helper** - Not needed, used workflow_id directly from Task

#### AI Tools

- [x] **Create fix.ts tool** - Created `ai-tools/fix.ts` for maintainer to propose fixes:
  - Parameters: `code` (string), `comment` (string)
  - Race condition check: compare `currentScript.major_version` with `expectedMajorVersion`
  - If stale, return `{ applied: false }` and clear maintenance flag
  - If valid, create new script with same `major_version`, incremented `minor_version`
  - Update workflow `active_script_id`, clear `maintenance`, set `next_run_timestamp` to now
  - Return `{ script, applied: true }`
- [x] **Wire up fix tool in agent.ts** - Added conditional tool registration (fix for maintainer, save/ask/schedule for others)
- [x] **MaintainerContext in AgentTask** - Added interface and optional field for passing workflow/version info
- [x] **Update save.ts tool** - Updated to increment `major_version` and reset `minor_version` to 0

#### Agent Environment

- [x] **Add maintainer temperature** - Added `case "maintainer": return 0.1;` in `agent-env.ts` temperature getter
- [x] **Add maintainer to buildSystem switch** - Added `case "maintainer": systemPrompt = this.maintainerSystemPrompt(); break;`
- [x] **maintainerSystemPrompt method** - Implemented bounded repair agent system prompt with:
  - Role: autonomous repair, no user interaction
  - Input: scriptCode, scriptVersion, error, logs, result
  - Output: `fix` tool only (plus `eval` for testing)
  - Constraints: preserve intent, minimal fix, no feature changes, backward-compatible
  - Escalation: if cannot fix, explain why (no `fix` call)

### UI Layer (`apps/web`)

#### Completed
- [x] **Maintenance status indicator** - MainPage shows "Auto-fixing issue..." when `workflow.maintenance === true`
- [x] **Maintenance events** - Events for maintenance_started, maintenance_escalated, maintenance_fixed exist

#### Partially Complete
- [x] **EscalatedCard component** - Exists but uses `escalated` notification type, not `maintenance_failed`

#### Not Started
- [ ] **Auto-fix thread display** - Show maintainer tasks as separate auto-fix threads in WorkflowDetailPage (query via `getMaintainerTasksForWorkflow`)
- [ ] **Version display format** - Update version display to show `X.Y` format (major.minor) instead of single integer (v1, v2)
- [ ] **Maintenance failed notification** - Add `maintenance_failed` notification type with explanation and "Re-plan" action
- [ ] **getMaintainerTasksForWorkflow query hook** - Add React Query hook for fetching maintainer tasks

### Testing

- [x] **Unit tests for enterMaintenanceMode** - Test transaction atomicity, fix count increment, task/inbox creation (packages/tests/src/api.test.ts)
- [x] **Unit tests for fix tool** - Test race condition handling, version incrementing, workflow updates (packages/tests/src/fix-tool.test.ts)
- [x] **Unit tests for save tool** - Test major version increment and minor version reset (packages/tests/src/save-tool.test.ts)
- [ ] **Unit tests for maintainer context loading** - Test changelog construction from prior minor versions
- [x] **Unit tests for task scheduler priority** - Test planner-over-maintainer prioritization
- [ ] **Integration test: logic error to fix** - End-to-end test of logic error -> maintainer task -> fix applied -> re-run
- [ ] **Integration test: fix escalation** - Test max fix attempts -> user escalation flow

---

## Priority 2: Tier 1 v1 Features (Critical)

### Dry-Run Testing

**Idea:** [ideas/dry-run-testing.md](ideas/dry-run-testing.md)

Add ability to test workflow scripts without side effects.

- [ ] **Dry-run mode flag** - Add dry-run parameter to script execution
- [ ] **Side-effect interception** - Mock external API calls and mutations in dry-run mode
- [ ] **Result preview** - Show what would happen without actually executing
- [ ] **UI trigger** - Add "Test Run" button in workflow detail page

### Collapse Low-Signal Events

**Idea:** [ideas/collapse-low-signal-events.md](ideas/collapse-low-signal-events.md)

Reduce visual noise in event timeline.

- [ ] **Event significance classification** - Categorize events by importance
- [ ] **Collapsible event groups** - Group low-signal events with expand option
- [ ] **Smart summarization** - Show count/summary for collapsed events
- [ ] **User preference persistence** - Remember collapse preferences

### Highlight Significant Events

**Idea:** [ideas/highlight-significant-events.md](ideas/highlight-significant-events.md)

Make important events stand out in the timeline.

- [ ] **Significance scoring** - Assign importance scores to event types
- [ ] **Visual differentiation** - Distinct styling for high-signal events
- [ ] **Filter by significance** - Option to show only significant events
- [ ] **Notification integration** - Link significant events to notifications

### Detect Abandoned Drafts

**Idea:** [ideas/detect-abandoned-drafts.md](ideas/detect-abandoned-drafts.md)

System to identify drafts with no activity.

- [ ] **Inactivity threshold** - Define what constitutes "abandoned" (e.g., 7 days no activity)
- [ ] **Last activity tracking** - Track last interaction timestamp per draft
- [ ] **Detection query** - Query to find drafts exceeding inactivity threshold
- [ ] **Abandoned status flag** - Mark drafts as potentially abandoned

---

## Priority 3: Tier 2 v1 Features (Important)

### Prompt Stale Drafts

**Idea:** [ideas/prompt-stale-drafts.md](ideas/prompt-stale-drafts.md)

Notify users about stale drafts.

- [ ] **Stale detection criteria** - Define staleness (e.g., 3 days no progress)
- [ ] **Notification generation** - Create prompts for stale drafts
- [ ] **Actionable notifications** - Include "Continue" / "Archive" actions
- [ ] **Frequency control** - Limit reminder frequency per draft

### Archive Old Drafts

**Idea:** [ideas/archive-old-drafts.md](ideas/archive-old-drafts.md)

Auto-archive drafts after extended inactivity.

- [ ] **Archive threshold** - Define auto-archive period (e.g., 30 days)
- [ ] **Archive action** - Move to archived state without deletion
- [ ] **Unarchive capability** - Allow restoration from archive
- [ ] **Archive notification** - Notify user before auto-archive

### Script Versioning UI (Rollback)

**Idea:** [ideas/script-versioning.md](ideas/script-versioning.md)

Interface to view and rollback script versions.

**Note:** Depends on Maintainer Task Type version schema (major_version + minor_version).

- [ ] **Version history view** - Display all versions with timestamps and comments
- [ ] **Version comparison** - Side-by-side diff between versions
- [ ] **Rollback action** - One-click rollback to previous version
- [ ] **Rollback confirmation** - Confirm before rollback with impact summary

### Agent Status from Active Runs

**Idea:** [ideas/agent-status-from-active-runs.md](ideas/agent-status-from-active-runs.md)

Derive agent status from active task_runs/script_runs instead of manual setAgentStatus calls.

- [ ] **Remove manual status calls** - Audit and remove explicit setAgentStatus calls
- [ ] **Status derivation logic** - Compute status from active runs (idle/working/waiting)
- [ ] **Real-time status updates** - Subscribe to run state changes for UI updates
- [ ] **Status query optimization** - Efficient query for current agent status

---

## Priority 4: Tier 3 v1 Features (Nice-to-have)

### Script Diff View

**Idea:** [ideas/script-diff-view.md](ideas/script-diff-view.md)

Show differences between script versions.

- [ ] **Diff algorithm** - Implement line-by-line diff
- [ ] **Syntax highlighting** - Highlight additions/deletions with colors
- [ ] **Inline vs side-by-side** - Toggle between diff display modes
- [ ] **Change summary** - Summarize what changed between versions

### Simplify Question-Answering

**Idea:** [ideas/simplify-question-answering.md](ideas/simplify-question-answering.md)

Quick reply options for agent questions.

- [ ] **Common response suggestions** - Pre-populate likely answers
- [ ] **One-click responses** - Quick-action buttons for common replies
- [ ] **Smart defaults** - Suggest most likely response based on context
- [ ] **Response templates** - Reusable response patterns

### Handle Abandoned Drafts

**Idea:** [ideas/handle-abandoned-drafts.md](ideas/handle-abandoned-drafts.md)

Actions for dealing with abandoned drafts.

**Note:** Depends on Detect Abandoned Drafts (Priority 2).

- [ ] **User prompt flow** - Prompt user to continue or archive
- [ ] **Bulk actions** - Handle multiple abandoned drafts at once
- [ ] **Auto-archive option** - Opt-in automatic archival
- [ ] **Recovery flow** - Easy restoration if archived by mistake

---

## Priority 5: Post-v1 Features

### User Balance and Payments

**Idea:** [ideas/user-balance-and-payments.md](ideas/user-balance-and-payments.md)

Implement billing/payment system.

- [ ] **Balance tracking** - Track user balance/credits
- [ ] **Usage metering** - Measure resource consumption
- [ ] **Payment integration** - Connect payment provider
- [ ] **Billing UI** - User-facing billing dashboard

### In-App Bug Report

**Idea:** [ideas/in-app-bug-report.md](ideas/in-app-bug-report.md)

Easy way to report issues from within the app.

**Status:** Partially implemented - bug report dialog exists in UI.

- [x] **Report dialog** - In-app bug report form (exists)
- [ ] **Context capture** - Auto-include relevant state/logs
- [ ] **Screenshot attachment** - Option to attach screenshots
- [ ] **Issue tracking integration** - Submit to issue tracker

---

## Test Coverage Gaps

Areas identified as lacking test coverage:

### packages/db

- [ ] Tests for `connection-store.ts`
- [ ] Tests for `inbox-store.ts`
- [ ] Tests for `memory-store.ts`
- [ ] Tests for `file-store.ts`

### packages/node

- [ ] Tests for `TransportServerFastify`
- [ ] Tests for `getDBPath`
- [ ] Tests for `mimeUtils`
- [ ] Tests for `fileUtils`
- [ ] Tests for `compression`

### Skipped Tests (Environment Constraints)

6 skipped tests total, all with valid reasons:
- Browser-specific tests (WASM environment)
- P2P sync tests (requires real network)
- Network-dependent tests

---

## Code Quality Notes

### Current Status
- **FIXMEs:** 2 (both in P2P sync code - optimization deferred)
- **Skipped tests:** 6 (all environment constraints - P2P, browser, network)
- **Placeholder implementations:** None blocking v1
- **Overall:** Clean codebase, no critical issues

### Current Notification Types
The system supports 4 notification types:
- `error` - General errors
- `escalated` - User escalation needed
- `script_message` - Script output messages
- `script_ask` - Script questions to user

**Note:** `maintenance_failed` notification type needs to be added for maintainer escalations.

---

## Implementation Notes

### Version Migration Strategy

When migrating from `version` to `major_version` + `minor_version`:
1. All existing scripts get their `version` value as `major_version`
2. All existing scripts get `minor_version = 0`
3. Queries ordered by version become: `ORDER BY major_version DESC, minor_version DESC`

### Race Condition Handling

The maintainer's fix tool must check that the planner hasn't updated the script while maintainer was working:
1. Maintainer loads script with `major_version = X`
2. Before applying fix, check current `major_version` is still `X`
3. If changed (planner saved new version), discard fix (return `applied: false`)
4. Scheduler prevents concurrent execution by prioritizing planner

### Maintainer Thread Isolation

Maintainer tasks:
- Have their own `thread_id` (not linked to user chat)
- Have empty `chat_id` (do not write to user-facing chat)
- Messages stored for debugging but not shown in chat
- Only visible in UI as "auto-fix threads" on workflow detail page

### Context Injection for Maintainer

The maintainer agent receives its context through the enriched inbox message which includes:
- Script code that failed
- Error details (type, message)
- Last 50 lines of logs
- Formatted version string (e.g., "2.1")
- Changelog of prior minor versions

### Maintainer Completion Handling

When the maintainer task finishes, `handleMaintainerCompletion` checks:
1. If `fix` tool was called (by looking for `tool-fix` part type in agent history)
2. If fix was applied (maintenance flag cleared by fix tool)
3. If fix was not called, escalates to user with maintainer's explanation

### Task Scheduler Priority

The scheduler now handles maintainer tasks with per-workflow conflict resolution:
- If both planner and maintainer tasks exist for the same workflow, maintainer is skipped
- Priority order: planner > worker > maintainer

### Dependency Order for Maintainer Task Type

Implementation must follow this order:

```
1. DB Layer (Schema)
   ├── Migration: version -> major_version + minor_version
   ├── Script interface update
   ├── Update script queries
   └── Version helper functions

2. DB Layer (Types & Methods)
   ├── TaskType enum + "maintainer"
   ├── InboxItemTarget + "maintainer"
   ├── enterMaintenanceMode() transaction
   └── getMaintainerTasksForWorkflow()

3. Agent Layer (Core)
   ├── task-worker.ts: support maintainer type
   ├── MaintainerContext interface
   ├── loadMaintainerContext()
   └── getMaintainerTools()

4. Agent Layer (Tools)
   ├── Create fix.ts tool (new)
   └── Update save.ts (major/minor versions)

5. Agent Layer (Routing)
   ├── workflow-worker.ts: route to maintainer
   ├── task-scheduler.ts: planner priority
   └── handleMaintainerCompletion()

6. Agent Layer (Environment)
   ├── agent-env.ts: maintainer temperature
   ├── buildSystem: maintainer case
   └── maintainerSystemPrompt()

7. UI Layer
   ├── Version display format (X.Y)
   ├── maintenance_failed notification type
   ├── Auto-fix thread display
   └── getMaintainerTasksForWorkflow hook

8. Testing
   ├── Unit tests per component
   └── Integration tests
```

### Key Implementation Notes

1. **task-worker.ts line 112** - Currently rejects maintainer type. Must be updated before any maintainer tasks can run.

2. **enterMaintenanceMode() routing** - Currently routes to planner inbox. Needs to route to new maintainer task instead.

3. **save.ts version handling** - Uses single `version` field. Must be updated after migration adds `major_version`/`minor_version`.

4. **Notification type addition** - Add `maintenance_failed` to the 4 existing types (error, escalated, script_message, script_ask).

5. **UI version display** - Currently shows `v1`, `v2`. Needs to show `1.0`, `1.1`, `2.0` format.
