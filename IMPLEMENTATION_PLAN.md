# Keep.AI v1 Implementation Plan

This document outlines the remaining work needed to ship a simple, lovable, and complete v1 of Keep.AI - a local personal automation product where AI creates and maintains automations for users.

The items below are prioritized by impact on user experience and product completeness. Each item references the relevant spec(s) and includes specific file locations and implementation notes.

**Last Updated:** 2026-01-16 (comprehensive codebase audit completed)

---

## CRITICAL (Must have for v1)

These features are core to the product promise. Without them, the product feels incomplete or broken.

### 1. Main Screen Consolidation (COMPLETED 2026-01-16)
The spec shows a unified main screen with input box and workflow list together, but they are currently on separate routes.

- [x] **Unify input box and workflow list on single page** - Created MainPage.tsx combining both
  - File: `/apps/web/src/components/ChatPage.tsx` (lines 106-178) - Contains the PromptInput component
  - File: `/apps/web/src/components/WorkflowsPage.tsx` (lines 48-74) - Contains workflow list
  - File: `/apps/web/src/App.tsx` (lines 217-238) - Route configuration
  - Create new unified `MainPage.tsx` that combines both

- [x] **Add attention banner** - Shows "X need attention" banner with click to filter
  - Add to unified main page
  - Click should filter to attention items only

- [x] **Compute attention state** - Calculates attention from failed runs and waiting tasks
  - Attention = failed recent run OR waiting for user input (task.state="wait" or "asks")
  - May require new computed field or join in workflow queries

- [x] **Add secondary line to workflow list items** - Shows run status with time formatting
  - Currently shows: cron/events/created (lines 63-68 in WorkflowsPage.tsx)
  - Should show: "Last run: 2h ago ✓", "Waiting for your input", "⚠ Failed 3h ago - needs attention", "Not scheduled", "Next run: {time}"
  - Requires joining with latest `script_run` and checking `task.state`

- [x] **Sort workflow list by attention first** - Attention items appear at top

### 2. Status Badge Alignment (COMPLETED 2026-01-16)
Current UI uses wrong terminology and colors for workflow status badges.

- [x] **Update status terminology** - Change from "Pending/Active/Disabled" to "Draft/Running/Paused" [Spec 00]
  - File: `/apps/web/src/components/WorkflowsPage.tsx` lines 7-15 - `getStatusBadge()` function
  - Current: `""` shows "Pending" with `variant="outline"` -> Change to "Draft"
  - Current: `"active"` shows "Active" with `bg-green-100` -> Change label to "Running"
  - Current: `"disabled"` shows "Disabled" with `variant="secondary"` -> Change to "Paused"
  - Also update: WorkflowDetailPage.tsx:119, TasksPage.tsx:54, TaskDetailPage.tsx:127

- [x] **Fix Paused badge color** - Should be yellow, not gray [Spec 00]
  - Currently gray via `variant="secondary"` (line 9)
  - Change to `className="bg-yellow-100 text-yellow-800"` or create yellow badge variant

- [x] **Fixed pre-existing type errors in sandbox.test.ts** (Symbol.dispose and EvalGlobal type)

- [x] **Fixed pre-existing type error in PushNotificationManager.ts** (ArrayBuffer type)

- [x] **Fixed sandbox abort signal error message handling**

- [x] **Add visual attention indicator** - Implemented red left border for attention items in MainPage.tsx
  - Add conditional left border or pulse animation to list items
  - Example: `border-l-4 border-red-500` for attention items

### 3. Autonomy Toggle System (COMPLETED 2026-01-16)
Core product differentiator - user controls how much the AI decides vs coordinates.

- [x] **Add autonomy preference storage** - Implemented useAutonomyPreference hook using localStorage

- [x] **Add autonomy toggle UI on main screen** - Added toggle below input with tooltip explanation

- [x] **Respect autonomy setting in agent planning** - Backend integration completed
  - File: `/packages/proto/src/schemas.ts` - Added AutonomyMode type and autonomy field to metadata
  - File: `/packages/db/src/api.ts` - Added setAutonomyMode/getAutonomyMode methods using agent_state table
  - File: `/apps/web/src/hooks/useAutonomyPreference.ts` - Updated to sync with backend database
  - File: `/packages/agent/src/task-worker.ts` - Retrieves autonomy mode and passes to AgentEnv
  - File: `/packages/agent/src/agent-env.ts` - Added autonomyPrompt() method with mode-specific guidance
  - When "coordinate": agent asks clarifying questions before significant actions
  - When "ai_decides": agent uses safe defaults and minimizes questions

- [x] **Respect autonomy setting in modifications** - Same backend integration handles all agent interactions

### 4. Error Classification System (COMPLETED 2026-01-16)
Required for maintenance mode and proper error handling.

- [x] **Create typed error classes** - Implement error types for classification [Spec 09b]
  - File: `/packages/agent/src/errors.ts` - New file created
  - Classes: `AuthError`, `PermissionError`, `NetworkError`, `LogicError`
  - Each extends `ClassifiedError` base class with `type` property
  - Helper functions: `classifyHttpError()`, `classifyFileError()`, `classifyGenericError()`, `classifyGoogleApiError()`
  - Exported from `/packages/agent/src/index.ts`

- [x] **Classify errors at tool level** - Each tool wrapper throws typed errors [Spec 09b]
  - Files updated: `gmail.ts`, `web-fetch.ts`, `web-download.ts`, `text-extract.ts`, `web-search.ts`, `read-file.ts`, `save-file.ts`
  - Classification rules:
    - 401 -> AuthError
    - 403 -> PermissionError
    - 5xx/timeout/connection refused -> NetworkError
    - Parsing/null reference/unexpected data -> LogicError

- [x] **Propagate typed errors through sandbox** [Spec 09b]
  - File: `/packages/agent/src/sandbox/api.ts` - Updated tool wrapper to preserve error types
  - Classified errors are re-thrown with enhanced context
  - Unclassified errors are wrapped as LogicError

- [x] **Route errors based on type** [Spec 09, 09b, 10]
  - File: `/packages/agent/src/workflow-worker.ts` - Updated error handling
  - File: `/packages/agent/src/workflow-worker-signal.ts` - Added `needs_attention` and `maintenance` signal types
  - Auth/permission errors -> set workflow status to "error", emit `needs_attention` signal (no retry)
  - Network errors -> emit `retry` signal with backoff
  - Logic errors -> enter maintenance mode, route to planner inbox for auto-fix

### 5. Maintenance Mode for Logic Errors (COMPLETED 2026-01-16)
The "magical" auto-fix feature that makes the product special.

- [x] **Add `maintenance` flag to workflows table** [Spec 09b]
  - File: `/packages/db/src/migrations/v18.ts` - Created migration adding maintenance column
  - File: `/packages/db/src/script-store.ts` - Updated Workflow interface with `maintenance: boolean`
  - File: `/packages/db/src/database.ts` - Registered v18 migration
  - File: `/packages/db/src/api.ts` - Updated workflow creation to include `maintenance: false`

- [x] **Skip workflows in maintenance during scheduling** [Spec 07, 09b]
  - File: `/packages/agent/src/workflow-scheduler.ts` - Added `!w.maintenance` check in active workflows filter
  - Workflows in maintenance mode are skipped until maintenance is cleared

- [x] **Route logic errors to agent inbox** [Spec 09b]
  - File: `/packages/agent/src/workflow-worker.ts` - Added `enterMaintenanceMode()` method
  - When logic error occurs, creates inbox item for planner task with error context
  - Includes: error message, stack trace, recent logs, script code
  - Creates `maintenance_started` chat event for visibility

- [x] **Implement agent auto-fix workflow** [Spec 09b]
  - File: `/packages/agent/src/ai-tools/save.ts` - Updated to detect and exit maintenance mode
  - When agent saves a fix, workflow.maintenance is cleared
  - Sets next_run_timestamp to trigger immediate re-run to verify fix
  - Creates `maintenance_fixed` chat event

- [ ] **Add fix attempt tracking and escalation** [Spec 09b]
  - Track consecutive failed fix attempts (use notes or new field)
  - After N failed attempts, escalate to user and pause workflow
  - **Status:** TBD per spec - exact retry limits and escalation rules not yet defined

- [x] **Show "Fixed: [issue]" in chat** [Spec 09b]
  - `maintenance_fixed` chat event created when save tool exits maintenance mode
  - Includes fix_comment from the agent's commit message

### 6. Mermaid Diagram Display (COMPLETED 2026-01-16)
Visual explanation of automation logic for users.

- [x] **Add `summary` and `diagram` fields to scripts table** [Spec 12]
  - File: `/packages/db/src/migrations/v19.ts` - Created migration adding fields
  - File: `/packages/db/src/script-store.ts` - Updated Script interface with summary and diagram fields
  - File: `/packages/db/src/database.ts` - Registered v19 migration
  - All SELECT/INSERT queries updated to include new fields

- [x] **Update save tool to accept summary/diagram** [Spec 03, 12]
  - File: `/packages/agent/src/ai-tools/save.ts`
  - Added `summary` and `diagram` as optional parameters in SaveInfoSchema
  - Script creation includes summary and diagram fields

- [x] **Install and integrate mermaid renderer** [Spec 12]
  - mermaid package installed in apps/web
  - Created `/apps/web/src/components/MermaidDiagram.tsx` component
  - Component renders Mermaid diagrams with error handling

- [x] **Display summary and diagram on workflow detail page** [Spec 12]
  - File: `/apps/web/src/components/WorkflowDetailPage.tsx`
  - Added "What This Automation Does" section after Script section
  - Shows one-sentence summary and Mermaid flowchart diagram

- [x] **Generate explanation on script save** [Spec 03, 12]
  - File: `/packages/agent/src/agent-env.ts` - Updated plannerSystemPrompt
  - Agent is instructed to provide summary and diagram when using save tool
  - Includes example Mermaid flowchart format

---

## HIGH PRIORITY

These features significantly improve user experience and product polish.

### 7. Activation Flow (COMPLETED 2026-01-16)
Clear security boundary between drafts and running automations.

- [x] **Fix scheduler to only run "active" workflows** [Spec 06]
  - File: `/packages/agent/src/workflow-scheduler.ts`
  - Changed filter to only execute workflows with `status === 'active'`
  - Draft ("") and Paused ("disabled") workflows no longer run automatically

- [x] **Add distinct "Activate" button for drafts** [Spec 06]
  - File: `/apps/web/src/components/WorkflowDetailPage.tsx`
  - Shows green "Activate" button only for draft workflows with a script
  - Clicking sets `status = "active"` to enable scheduling

- [x] **Pre-activation validation** [Spec 06]
  - Button only appears if `latestScript` exists
  - Shows "Script required to activate" hint when no script saved

- [x] **Add proper button states** [Spec 06]
  - Draft + script: "Activate" (green) + "Run now"
  - Active: "Run now" + "Pause"
  - Paused: "Resume"

- [x] **"Run now" button for testing** [Spec 06]
  - Available for draft and active workflows with scripts
  - Sets `next_run_timestamp` to now for immediate execution

### 8. OS-Level Notifications
Use native OS notifications, not just app-internal or push.

- [ ] **Implement Electron.Notification for errors** [Spec 09]
  - File: `/apps/electron/src/main.ts`
  - Import `Notification` from electron (currently NOT imported)
  - Create notifications on workflow failures requiring user action
  - Title: "{Workflow name} needs attention"
  - Body: Brief error summary
  - Click action: Open app to action screen

- [ ] **Filter notifications by error type** [Spec 09, 09b]
  - Only notify for non-fixable errors (auth/permission/network)
  - Don't notify for logic errors being auto-fixed
  - Requires error classification system (item #4)

- [ ] **Add tray badge for attention items** [Spec 00, 09]
  - File: `/apps/electron/src/main.ts` (createTray function around line 136)
  - Show count on tray icon when workflows need attention
  - Use `tray.setTitle()` on macOS or custom badge overlay
  - Add IPC handler for renderer to update badge count

### 9. Tray Menu Completion

- [ ] **Add "New automation..." option** [Spec 01]
  - File: `/apps/electron/src/main.ts` lines 155-174 (contextMenu template)
  - Current menu only has: "Open Keep.AI", separator, "Quit"
  - Add menu item that opens app with input focused
  - Add IPC handler: `ipcMain.handle('focus-input', ...)`
  - Renderer needs corresponding listener

- [ ] **Add "Pause all automations" option** [Spec 11]
  - File: `/apps/electron/src/main.ts` lines 155-174
  - Pauses all active workflows via API call to server
  - Set `status = "disabled"` for all active workflows

- [ ] **Add Cmd/Ctrl+N global shortcut** [Spec 00, 01]
  - File: `/apps/electron/src/main.ts`
  - Import and use `globalShortcut` from electron (currently NOT used)
  - Register shortcut: `globalShortcut.register('CmdOrCtrl+N', ...)`
  - Shows/focuses window and focuses input box

### 10. Retry Tracking

- [ ] **Add `retry_of` and `retry_count` to script_runs table** [Spec 10]
  - File: `/packages/db/src/script-store.ts` - Update ScriptRun interface
  - Current script_runs schema: id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type
  - **Missing:** retry_of, retry_count fields
  - Create migration adding: `retry_of TEXT`, `retry_count INTEGER DEFAULT 0`

- [ ] **Update retry logic to track lineage** [Spec 10]
  - File: `/packages/agent/src/workflow-worker.ts`
  - When creating retry run, set retry_of to original run ID
  - Increment retry_count from previous run

- [ ] **Display retry chain in run history** [Spec 08, 10]
  - File: `/apps/web/src/components/ScriptRunDetailPage.tsx`
  - Show "Retry #N of {original run}" when viewing a retry
  - Link to original failed run

---

## MEDIUM PRIORITY

Improve completeness and handle edge cases.

### 11. Event Menu Actions

- [ ] **Implement "Mute this task" action** [Spec 08]
  - File: `/apps/web/src/components/TaskEventGroup.tsx` line 82 - currently console.log only
  - Suppress future notifications for specific task
  - Needs spec for mute behavior/duration

- [ ] **Implement "Mute workflow" action** [Spec 08]
  - File: `/apps/web/src/components/WorkflowEventGroup.tsx` line 59 - currently console.log only
  - Suppress all notifications for workflow
  - Needs spec

- [ ] **Implement "Retry" action from event menu** [Spec 10]
  - File: `/apps/web/src/components/EventItem.tsx` line 32 - currently console.log only
  - Trigger immediate re-run from failed run event

### 12. Question Simplification

- [ ] **Add quick-reply buttons for agent questions** [Spec 02]
  - When agent asks yes/no or multiple choice, show buttons
  - File: `/apps/web/src/components/ChatInterface.tsx`
  - Needs spec for structured question format

- [ ] **Support structured question formats** [Spec 02]
  - Agent can specify answer options in response
  - UI renders as buttons/chips instead of free text input

### 13. Dry-Run Testing

- [ ] **Promote test run button** [Spec 06]
  - Make more prominent/discoverable before enabling
  - File: `/apps/web/src/components/WorkflowDetailPage.tsx`
  - Needs spec

- [ ] **Improve test run results display** [Spec 06]
  - Show clear success/failure with output preview
  - Needs spec

- [ ] **Add "Test before enabling" prompt** [Spec 06]
  - Suggest testing when user tries to activate untested draft
  - Needs spec

### 14. Code Quality - FIXMEs (12 total)

- [ ] **Fix timezone assumption bug**
  - File: `/packages/db/src/task-store.ts` line 379
  - FIXME: "This assumes the server's timezone is the user's local timezone"
  - Should be configurable per user or use specific timezone

- [ ] **Fix mutations not triggering sync**
  - File: `/apps/server/src/server.ts` line 759
  - FIXME: "call it on every mutation endpoint"
  - Currently has 1s delay polling instead of immediate trigger
  - **Impact:** Up to 1 second delay for task/workflow processing

- [ ] **Fix transaction delivery reliability**
  - File: `/packages/sync/src/Peer.ts` line 788
  - FIXME: "look into ensuring tx delivery by organizing change batches properly"

- [ ] **Enable output validation**
  - File: `/packages/agent/src/sandbox/api.ts` line 138
  - FIXME: "not sure if all tools return all declared fields"
  - Output schema validation is disabled, should validate and fix tools

- [ ] **Add thread title generation**
  - File: `/packages/agent/src/task-worker.ts` line 116
  - FIXME: "add title?"
  - Currently uses placeholder "Placeholder" for thread titles

- [ ] **Enable context building**
  - File: `/packages/agent/src/agent-env.ts` lines 85-203 (large commented block)
  - FIXME: "add task info, workflow info, etc"
  - ~117 lines of disabled context-building code (chat events, task info, active task list)
  - `buildContext()` currently returns empty array

- [ ] **Fix file/image parts handling**
  - File: `/packages/agent/src/agent-env.ts` line 64
  - FIXME: "this is ugly hack, we don't want to send file/image parts"
  - File parts stripped from messages, only metadata kept

- [ ] **Deprecate legacy task fields**
  - File: `/packages/db/src/migrations/v1.ts` line 19
  - FIXME: "deprecate deleted, cron and task fields" on tasks table

### 15. Code Quality - Debug Statements

- [ ] **Remove console.log statements** - 60+ occurrences across codebase
  - Key files to clean:
    - `/apps/web/src/QueryProvider.tsx` (14+ statements)
    - `/apps/web/src/components/ConsolePage.tsx` (19 statements)
    - `/apps/web/src/components/WorkflowEventGroup.tsx` line 60
    - `/apps/web/src/components/EventItem.tsx` line 33
    - `/apps/web/src/components/TaskEventGroup.tsx` line 83
    - `/apps/web/src/main.tsx` (3 statements)
    - `/apps/server/src/server.ts` (3 statements)
    - `/packages/sync/src/Peer.ts` (6 statements)
  - Replace with proper debug logging or remove

- [ ] **Remove commented code blocks**
  - File: `/packages/agent/src/agent-env.ts` - ~117 lines of commented context code
  - File: `/packages/db/src/task-store.ts` - ~25 lines commented
  - File: `/packages/tests/src/nostr-transport-sync.test.ts` - ~35 lines commented
  - Review and either restore or delete

### 16. Test Fixes

- [ ] **Fix failing file-transfer.test.ts**
  - File: `/packages/tests/src/file-transfer.test.ts`
  - Currently broken

- [ ] **Add schema migration tests**
  - Ensure database migrations work correctly
  - Test upgrade paths from each version

---

## NICE-TO-HAVE (Consider for v1 polish)

These add polish but are not essential for launch.

### 17. Script Version History UI

- [ ] **Add diff view between script versions** [Spec 12]
  - Show what changed between versions
  - Needs spec

- [ ] **Add one-click rollback** [Spec 13]
  - Revert to previous script version easily
  - Needs spec

- [ ] **Improve version list UI** [Spec 12]
  - Better visual hierarchy and timestamps

### 18. Event Collapsing

- [ ] **Collapse low-signal events** [Spec 08]
  - Group routine successful runs
  - Expand on click
  - Needs spec

- [ ] **Highlight significant events** [Spec 08]
  - Failures, fixes, and user interactions stand out
  - Needs spec

### 19. Abandoned Draft Handling

- [ ] **Detect abandoned drafts** [Spec 00]
  - Drafts with no activity for X days
  - Needs spec

- [ ] **Prompt user about stale drafts** [Spec 00]
  - "You have 3 drafts waiting - want to continue?"
  - Needs spec

- [ ] **Archive old drafts** [Spec 00]
  - Move very old drafts to archive instead of deleting
  - Needs spec

### 20. Empty State & Onboarding

- [ ] **Add example suggestions** [Spec 00]
  - Show 2-3 example automations for first-time users
  - Currently no empty state guidance

- [ ] **Add "Press Enter to create" hint** [Spec 00]
  - Subtle hint when typing in input

### 21. Real-time Updates

- [ ] **Verify workflow list updates in real-time** [Spec 00]
  - List should update via db sync as states change

- [ ] **Add subtle animations for state changes** [Spec 00]
  - Smooth transitions when status changes

---

## Implementation Order Recommendation

For a coherent v1, implement in this rough order:

### Phase 1: Foundation (Week 1-2)
1. **Status terminology + badge colors** - Quick win, fixes confusing current state
2. **Main screen consolidation** - Foundation for attention system
3. **Database schema updates** - Add maintenance, summary, diagram, retry fields

### Phase 2: Core Features (Week 2-3)
4. **Error classification + typed errors** - Required for maintenance mode
5. **Maintenance mode** - Enables "magical" auto-fix
6. **Attention banner + secondary lines** - Makes main screen useful

### Phase 3: User Experience (Week 3-4)
7. **Autonomy toggle** - Core product differentiator
8. **Mermaid diagrams** - Makes automations understandable
9. **Activation flow improvements** - Clear security boundaries

### Phase 4: Platform Polish (Week 4-5)
10. **OS notifications + tray enhancements** - Completes system tray experience
11. **Keyboard shortcuts** - Power user efficiency
12. **Event menu actions** - Complete interaction model

### Phase 5: Quality (Week 5+)
13. **Clean up FIXMEs** - Technical debt
14. **Remove console.logs** - Production readiness
15. **Fix tests** - CI/CD reliability

---

## Notes

- Items marked "(needs spec)" require a new spec document before implementation
- All specs referenced are in `/specs/` directory
- Database migrations should be tested carefully due to cr-sqlite complexity
- This plan focuses on user-facing features; infrastructure work should support these goals
- Re-evaluate priorities after each milestone based on user feedback

## File Reference Quick Links

| Area | Key Files |
|------|-----------|
| Web UI | `/apps/web/src/components/*.tsx` |
| Database | `/packages/db/src/*.ts`, `/packages/db/src/migrations/` |
| Agent | `/packages/agent/src/*.ts` |
| Sandbox | `/packages/agent/src/sandbox/*.ts` |
| Electron | `/apps/electron/src/main.ts` |
| Server | `/apps/server/src/server.ts` |
| Specs | `/specs/*.md` |
