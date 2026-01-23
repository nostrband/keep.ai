# Implementation Plan for Keep.AI v1.0.0 SLC Release

**Last Updated**: 2026-01-23
**Status**: 0 specs pending implementation, 24 implemented

---

## Priority 1: Bug Fixes (Quick Wins)

### 1. Fix Autonomy Toggle Form Submit
**Spec**: `specs/fix-autonomy-toggle-form-submit.md`
**Status**: IMPLEMENTED
**Effort**: Minimal (1 line)

**Problem**: Clicking autonomy toggle triggers form submission, redirecting to /chat/<id>

**Action Items**:
- File: `apps/web/src/components/MainPage.tsx` (line 358)
- Add `type="button"` attribute to the toggle button
- Prevents default form submission behavior

**Code Change**:
```tsx
// Before:
<button onClick={toggleAutonomy} ...>

// After:
<button type="button" onClick={toggleAutonomy} ...>
```

---

### 2. Hide Scroll Message in Empty Chat
**Spec**: `specs/hide-scroll-message-empty-chat.md`
**Status**: IMPLEMENTED
**Effort**: Minimal (1 line)

**Problem**: "Scroll up to load older messages" shows when chat is empty

**Current Code** (`ChatInterface.tsx:306`):
```tsx
{hasNextPage && (
```

**Action Items**:
- File: `apps/web/src/components/ChatInterface.tsx` (line 306)
- Add `rows.length > 0` check to prevent showing message when chat is empty

**Code Change**:
```tsx
// Before:
{hasNextPage && (

// After:
{hasNextPage && rows.length > 0 && (
```

---

### 3. Workflow Title Fallback to "New workflow"
**Spec**: `specs/workflow-title-new-workflow-fallback.md`
**Status**: IMPLEMENTED
**Effort**: Low (6 files, simple find-replace)

**Problem**: Workflows without titles show internal IDs like "Workflow 8a2b3c4d"

**Action Items** (replace `workflow.title || \`Workflow ${workflow.id.slice(0, 8)}\`` with `workflow.title || "New workflow"`):

| File | Line |
|------|------|
| `apps/web/src/components/MainPage.tsx` | 505 |
| `apps/web/src/components/WorkflowDetailPage.tsx` | 223 |
| `apps/web/src/components/WorkflowDetailPage.tsx` | 248 |
| `apps/web/src/components/WorkflowEventGroup.tsx` | 69 |
| `apps/web/src/components/WorkflowsPage.tsx` | 50 |
| `apps/web/src/components/TaskDetailPage.tsx` | 188 |

---

## Priority 2: UI/UX Improvements

### 4. Add Autonomy Toggle to Chat Page
**Spec**: `specs/01-chat-page-autonomy-toggle.md`
**Status**: IMPLEMENTED
**Effort**: Medium

**Problem**: Chat page lacks autonomy toggle that exists on homepage

**Current State**: ChatPage.tsx has no autonomy toggle at all

**Action Items**:
- File: `apps/web/src/components/ChatPage.tsx`
- Import `useAutonomyPreference` hook
- Import Info icon and Tooltip components
- Add toggle button in `PromptInputTools` component after file attachment button
- Implement same toggle behavior as MainPage (click to switch, hover for tooltip)

**Constraints**:
- Only show toggle after preference is loaded
- Use same styling as MainPage implementation

---

### 5. Make Workflow Info Box Sticky
**Spec**: `specs/02-workflow-info-box-sticky.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Current State**:
- `ChatDetailPage.tsx:121-125` - WorkflowInfoBox is not sticky
- `WorkflowInfoBox.tsx` - missing cursor-pointer on clickable element

**Action Items**:
- File: `apps/web/src/components/ChatDetailPage.tsx` (lines 121-125)
  - Wrap WorkflowInfoBox in `<div className="sticky top-[49px] z-10 bg-gray-50 border-b border-gray-200">`
- File: `apps/web/src/components/WorkflowInfoBox.tsx`
  - Add `cursor-pointer` class to the clickable button element

---

### 6. Fix Mermaid Fullscreen Background
**Spec**: `specs/03-mermaid-fullscreen-background.md`
**Status**: IMPLEMENTED
**Effort**: Low-Medium (requires CSS investigation)

**Problem**: Mermaid diagram fullscreen view has transparent background

**Current State**: No CSS overrides exist in `apps/web/src/index.css` for fullscreen

**Action Items**:
- Investigate streamdown library's fullscreen DOM structure
- File: `apps/web/src/index.css`
  - Add CSS override for fullscreen overlay background: `bg-gray-50` (#f9fafb)
  - Possible selectors: `.streamdown-fullscreen`, `[data-streamdown-fullscreen]`, or `.mermaid-fullscreen`
- Alternative: Check if streamdown accepts configuration props for background color

---

### 7. Rename Workflow Chat Button to "Edit"
**Spec**: `specs/04-workflow-chat-button-rename.md`
**Status**: IMPLEMENTED
**Effort**: Minimal (1 line)

**Current State**: `WorkflowDetailPage.tsx:320` still shows "Chat"

**Action Items**:
- File: `apps/web/src/components/WorkflowDetailPage.tsx` (line 320)
- Change button text from "Chat" to "Edit"

---

### 8. Move Automation Summary Section
**Spec**: `specs/05-workflow-move-automation-summary.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Current State**: Section is at lines 564-581, should be after line 377

**Action Items**:
- File: `apps/web/src/components/WorkflowDetailPage.tsx`
- Move "What This Automation Does" section (lines 564-581) to after line 377 (after Workflow Metadata)
- New section order: Error Alert -> Workflow Metadata -> What This Automation Does -> Chat -> Script -> Script Runs

---

### 9. Fix Workflow Pause/Resume Button Position
**Spec**: `specs/06-workflow-pause-resume-button-position.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: Pause/Resume buttons appear after Run/Test, not before

**Action Items**:
- File: `apps/web/src/components/WorkflowDetailPage.tsx` (lines 255-321)
- Reorder button render logic so primary action button (Activate/Pause/Resume) is always first
- Suggested order: [Activate OR Pause OR Resume] -> [Run now] -> [Test run] -> [Edit]
- Use conditional rendering within same position slot

---

### 10. Human-Readable Cron Display in Workflow Detail
**Spec**: `specs/07-workflow-human-readable-cron.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Current State**:
- `formatCronSchedule` function exists in `WorkflowInfoBox.tsx` but is NOT exported
- `WorkflowDetailPage.tsx` shows raw cron expression

**Action Items**:
- File: `apps/web/src/components/WorkflowInfoBox.tsx`
  - Export the existing `formatCronSchedule` function
- File: `apps/web/src/components/WorkflowDetailPage.tsx` (around line 360)
  - Import `formatCronSchedule` from WorkflowInfoBox
  - Change `{workflow.cron}` to `{formatCronSchedule(workflow.cron)}`

---

### 11. Fix Workflow Active vs Running Badge Confusion
**Spec**: `specs/08-workflow-active-vs-running-badge.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: `StatusBadge.tsx:9` shows "Running" for active workflows

**Action Items**:
- File: `apps/web/src/components/StatusBadge.tsx` (line 9)
  - Change `case "active"` badge text from "Running" to "Active"
- File: `apps/web/src/components/MainPage.tsx`
  - Add conditional "Running" badge (blue) when `latestRun && !latestRun.end_timestamp`
- File: `apps/web/src/components/WorkflowDetailPage.tsx`
  - Add same conditional "Running" badge next to status badge

---

### 12. Show Schedule in Workflow List
**Spec**: `specs/10-workflow-list-schedule-display.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Current State**: MainPage workflow list has no schedule display

**Action Items**:
- File: `apps/web/src/components/MainPage.tsx`
  - Import `formatCronSchedule` from WorkflowInfoBox (after #10 is done)
  - Add schedule display to workflow list card (below or next to status)
  - Show only if `workflow.cron` is set

---

### 13. Remove Workflow Task Row
**Spec**: `specs/remove-workflow-task-row.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: Task section exists at lines 406-428, exposes internal implementation details

**Action Items**:
- File: `apps/web/src/components/WorkflowDetailPage.tsx`
- Delete Task Section JSX block (lines 406-428)
- Remove `useTask` hook import and call if not used elsewhere

---

## Priority 3: Auth System Refactoring

These specs must be implemented in dependency order.

### 14. Fix Proactive needAuth Detection
**Spec**: `specs/fix-proactive-needauth-detection.md`
**Status**: IMPLEMENTED
**Effort**: Medium
**Dependency**: Required before #15, #16, and #17

**Problem**:
- `useNeedAuth` only reacts to errors, doesn't proactively detect missing API key
- Server `/check_config` endpoint (`server.ts:795-799`) returns only `{ok}`, needs `{ok, hasApiKey, hasBaseUrl}`
- No `isFirstLaunch` export exists

**Action Items** (implemented):
- File: `apps/server/src/server.ts` (lines 795-799)
  - Update `/api/check_config` endpoint to return `{ok, hasApiKey, hasBaseUrl}` instead of just `{ok}`
- File: `apps/web/src/hooks/useNeedAuth.ts`
  - Add config checking via `/check_config` endpoint on mount
  - Set `needAuth = true` if API key is missing (even if DB flag is false)
  - Add `isFirstLaunch` determination: true if both API key AND base URL are empty
  - Export `isFirstLaunch` flag for use in HeaderAuthNotice

---

### 15. Remove Blocking Auth from App
**Spec**: `specs/remove-blocking-auth-from-app.md`
**Status**: IMPLEMENTED
**Effort**: Low
**Dependency**: Requires #14 first

**Problem**: App.tsx blocks entire UI (lines 270-298) when config invalid, preventing browsing

**Action Items** (implemented):
- File: `apps/web/src/App.tsx` (lines 270-298)
- Delete blocking auth check section
- Remove `useConfig` import and usage if possible
- Let HeaderAuthNotice and AuthEventItem handle auth prompts as dismissable modals

---

### 16. Consolidate Auth/Config Hooks
**Spec**: `specs/consolidate-auth-config-hooks.md`
**Status**: IMPLEMENTED
**Effort**: Medium
**Dependency**: Requires #14 and #15 first

**Current State**: HeaderAuthNotice and AuthEventItem use both useConfig and useNeedAuth hooks

**Action Items** (implemented):
- Delete `apps/web/src/hooks/useConfig.ts` entirely
- Update `apps/web/src/components/HeaderAuthNotice.tsx`
  - Remove useConfig import and usage
  - Use only useNeedAuth (with enhanced isFirstLaunch flag)
- Update `apps/web/src/components/AuthEventItem.tsx`
  - Same refactor as HeaderAuthNotice
- Update `apps/web/src/App.tsx`
  - Remove useConfig import if present

---

### 17. Deprecate AuthDialog Component
**Spec**: `specs/deprecate-auth-dialog.md`
**Status**: IMPLEMENTED
**Effort**: Low
**Dependency**: Should be done after #15

**Problem**: AuthDialog.tsx (367 lines) is a full implementation, duplicates AuthPopup functionality, only used in App.tsx

**Action Items** (implemented):
- File: `apps/web/src/components/AuthDialog.tsx`
- Option A: Replace entire file with simple re-export:
  ```typescript
  /** @deprecated Use AuthPopup instead */
  export { AuthPopup as AuthDialog } from "./AuthPopup";
  ```
- Option B: Delete entirely if no code uses it after #15

---

### 18. Server Error Header Notice
**Spec**: `specs/11-server-error-header-notice.md`
**Status**: IMPLEMENTED
**Effort**: Medium

**Problem**:
- Server errors show as "Sign up" instead of "Server error"
- `useConfig` has no `isServerError` tracking

**Action Items** (implemented):
- File: `apps/web/src/hooks/useNeedAuth.ts`
  - Added `isServerError` field to state
  - Distinguishes between config invalid (API returned ok=false) and server unreachable (fetch failed)
- File: `apps/web/src/components/HeaderAuthNotice.tsx`
  - Checks `isServerError` flag
  - Shows "Server error" (red) when server is down in non-serverless mode

---

## Priority 4: Agent Improvements

### 19. Add Title Field to Agent Save Tool
**Spec**: `specs/09-agent-save-tool-title.md`
**Status**: IMPLEMENTED
**Effort**: Medium

**Current State**: `SaveInfoSchema` in `save.ts` has no title field

**Action Items** (implemented):
- File: `packages/agent/src/ai-tools/save.ts`
- Added required `title` field to `SaveInfoSchema`
- Updated execute function:
  - After saving script, checks if workflow.title is empty or whitespace-only
  - If empty, calls `scriptStore.updateWorkflowFields(workflowId, {title: info.title})`

**Constraints**:
- Only updates title if current workflow title is empty/whitespace
- Works for both draft and non-draft workflows

---

## Priority 5: Technical Debt & Code Quality

### 20. Fix EventSource for Node.js (FIXME)
**Location**: `packages/sync/src/TransportClientHttp.ts:176`
**Status**: IMPLEMENTED
**Effort**: Medium

**Problem**: SSE not implemented for Node.js environment

**Action Items**:
- Install `eventsource` npm package for Node.js SSE support
- Implement EventSource polyfill in Node.js code path

**Note**: Added eventsource npm package to packages/sync and updated TransportClientHttp.ts to use it for Node.js environments.

---

### 21. Optimize Chunk Publishing Threshold (FIXME)
**Location**: `packages/sync/src/nostr/stream/StreamWriter.ts:515`
**Effort**: Low

**Problem**: Hardcoded threshold (10) for pending chunks needs optimization

**Action Items**:
- Research optimal threshold based on bandwidth analysis
- Consider making configurable or adaptive

**Note**: Non-blocking technical debt item.

---

### 22. Review Transaction Delivery Logic (FIXME)
**Location**: `packages/sync/src/Peer.ts:788`
**Effort**: Medium-High

**Problem**: Potential issue with transaction delivery in change batching

**Action Items**:
- Investigate "ensuring tx delivery by organizing change batches properly"
- Add tests to verify correct behavior
- Fix any identified issues

**Note**: Non-blocking technical debt item.

---

### 23. Fix Skipped Test Suites
**Location**: `packages/tests`
**Effort**: Medium

**Problem**: 6 test suites are currently skipped

**Action Items**:
- Identify and list all skipped test suites
- Investigate why each was skipped
- Fix underlying issues or document why tests should remain skipped

**Note**: Non-blocking technical debt item.

---

## Ideas to Promote to Specs

These ideas from `ideas/` have been prioritized by potential impact and are candidates for promotion to full specs:

### 1. ~~Collapse Low-Signal Events~~ ✅ IMPLEMENTED
**Status**: Already implemented in codebase
**Files**: `EventListWithCollapse.tsx`, `CollapsedEventSummary.tsx`, `eventSignal.ts`

Auto-collapse routine events (Gmail reads, web fetches, etc.) in chat timeline.

---

### 2. ~~Detect/Archive/Prompt Abandoned Drafts~~ ✅ IMPLEMENTED
**Status**: Fully implemented in codebase
**Detection**: `script-store.ts` (getAbandonedDrafts, getDraftActivitySummary), `dbScriptReads.ts` (useAbandonedDrafts, useDraftActivitySummary hooks), `StaleDraftsBanner.tsx`
**Archive Feature**: `ArchivedPage.tsx`, `StatusBadge.tsx` (archived status), `WorkflowDetailPage.tsx` (archive/restore buttons), `MainPage.tsx` (filters out archived, shows link to archived)

Identify drafts with no activity for X days, surface with banner, and allow archiving/restoring.

---

### 3. ~~Highlight Significant Events~~ ✅ IMPLEMENTED
**Status**: Already implemented in codebase
**Files**: `EventItem.tsx` with `significanceStyles`, `events.ts` with `EventSignificance` type

Color-code events by type: errors (red), fixes (green), user interactions (blue), routine operations (gray).

---

### 4. ~~Dry-Run Testing~~ ✅ IMPLEMENTED
**Status**: Already implemented in codebase
**Files**: `WorkflowDetailPage.tsx` with `handleTestRun`, server endpoint `/workflow/test-run`

"Test run" button functionality is fully implemented.

---

### 5. Agent Status from Active Runs (MEDIUM PRIORITY)
**Impact**: Medium - accurate status display
**Complexity**: Medium

Derive agent status from active database records rather than event stream. Would show accurate "running" vs "idle" status.

**Why Prioritize**: Current status display can be misleading, causing user confusion about workflow state.

---

## Implementation Notes

### Codebase Patterns
- **Database**: CR-SQLite for conflict-free replication, migrations in `packages/db/src/migrations/`
- **State Management**: TanStack Query with table-based invalidation
- **Agent**: Tool-based architecture in `packages/agent/src/ai-tools/`
- **UI Components**: React with Tailwind CSS, shadcn/ui components

### Important Constraints
- All NOT NULL columns in CRR tables must have DEFAULT values
- ALTER TABLE on CRR tables can't have writes in same migration
- Use `crsql_begin_alter`/`crsql_commit_alter` when altering synched tables

### Validation Commands
```bash
# Type check
npm run type-check

# Build
cd apps/web && npm run build:frontend && cd ../server && npm run build:all

# Run server
cd apps/server && DEBUG="*" PORT=3001 npm start

# Tests
cd packages/tests && npm test
```

---

## Priority 6: Test Quality Improvements

These specs improve test coverage and ensure tests accurately reflect production behavior.

### 21. Align Test Schemas with Production Constraints
**Spec**: `specs/new/align-test-schemas-with-production.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: Test helper `createScriptTables` and `createTaskTables` don't match production schema constraints

**Action Items** (implemented):
- Updated `packages/tests/src/task-store.test.ts` - `createTaskTables` function
  - Added `DEFAULT ''` to all `NOT NULL` columns without defaults
  - Changed `deleted INTEGER DEFAULT 0` to `deleted INTEGER NOT NULL DEFAULT 0`
- Updated `packages/tests/src/script-store.test.ts` - `createScriptTables` function
  - Added `DEFAULT` values to match production migrations
  - Updated `chat_messages` table to include `task_run_id`, `script_id`, `failed_script_run_id` columns

---

### 22. Test Abandoned Drafts Boundary Conditions
**Spec**: `specs/new/test-abandoned-drafts-boundaries.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: Existing tests don't cover edge cases like exact threshold boundaries

**Action Items** (implemented):
- Added test: "should handle exact 7-day threshold boundary (just over - included)"
- Added test: "should handle exact 7-day threshold boundary (just under - excluded)"
- Added test: "should fallback to script timestamps when no chat_messages exist"
- Added test: "should detect task in 'asks' state as waiting for input"
- Added test: "should use most recent timestamp via COALESCE when multiple exist"
- Added test: "should document COALESCE behavior: chat_messages take precedence over scripts"
- Added test: "should fallback to workflow timestamp when no scripts or messages exist"

**Note**: One test documents a limitation in the current COALESCE query where chat_messages take precedence even if older than scripts.

---

### 23. Test Boolean-to-Integer Conversion Edge Cases
**Spec**: `specs/new/test-boolean-integer-conversion.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: Boolean values stored as integers (0/1) in SQLite need thorough testing

**Action Items** (implemented):
- Added tests for round-trip conversion (true → 1 → true, false → 0 → false)
- Added test for database integer 1 → true
- Added test for database integer 0 → false
- Added test for non-standard integer 2 → truthy
- Added test for negative integer -1 → truthy
- Added test for default value when maintenance not specified
- Added test for updateWorkflow with maintenance=true
- Added test for updateWorkflowFields with maintenance=false

---

### 24. Test Console-Log with Special Characters
**Spec**: `specs/new/test-console-log-special-chars.md`
**Status**: IMPLEMENTED
**Effort**: Low

**Problem**: consoleLogTool needs tests for special characters in log messages

**Action Items** (implemented):
- Added test: "should handle message containing single quotes"
- Added test: "should handle message containing newlines"
- Added test: "should handle message containing tabs"
- Added test: "should handle message containing carriage returns"
- Added test: "should handle message containing unicode characters"
- Added test: "should handle message containing emojis"
- Added test: "should handle message containing backslashes"
- Added test: "should handle message containing double quotes"
- Added test: "should handle message containing null character"
- Added test: "should handle message with only special characters"

---

## Summary

| Priority | Category | Count | Status |
|----------|----------|-------|--------|
| 1 | Bug Fixes | 3 | All implemented |
| 2 | UI/UX Improvements | 10 | All implemented |
| 3 | Auth System Refactoring | 5 | All implemented |
| 4 | Agent Improvements | 1 | All implemented |
| 5 | Technical Debt | 4 | 1 implemented, 3 pending (non-blocking) |
| 6 | Test Quality | 4 | All implemented |

**Total Specs**: 0 pending, 24 implemented

**Total Technical Debt Items**: 3 (non-blocking pending)

**Ideas Ready for Promotion**: 1 remaining (Agent Status from Active Runs)
- 4 ideas already implemented: Collapse Events, Highlight Events, Dry-Run Testing, Abandoned Drafts Detection

---

## Dependency Graph for Auth Specs

```
#14 Fix Proactive needAuth Detection
    |
    +---> #15 Remove Blocking Auth from App
    |         |
    |         +---> #17 Deprecate AuthDialog Component
    |
    +---> #16 Consolidate Auth/Config Hooks
              |
              +---> #18 Server Error Header Notice (may need adjustment)
```

**Recommended implementation order**: 14 -> 15 -> 16 -> 17 -> 18
