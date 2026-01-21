# Keep.AI Implementation Plan

## Overview

This document tracks remaining work for a simple, lovable, and complete v1 release of Keep.AI - a local personal automation product with AI creating and maintaining automations.

**Last Updated**: 2026-01-21
**Status**: Post code review - verified findings consolidated

---

## P0 - CRITICAL (Blocking Basic Functionality)

### 1. MainPage Form Submission Broken
**Spec**: `mainpage-submission-creates-task.md`
**Status**: FIXED (2026-01-21)
**Problem**: MainPage form submission is completely broken. Uses `addMessage.mutate()` with `chatId: "main"` which creates inbox items with empty `target_id` - TaskScheduler filters these out - automation requests vanish silently.

**Root Cause**: Lines 274-279 in MainPage.tsx use wrong API pattern.

**Fix Applied**:
1. Removed useAddMessage import and addMessage usage
2. Changed handleSubmit to use api.createTask() instead of addMessage.mutate()
3. Added isSubmitting state to prevent double submissions
4. After creating the task, navigate to the new chat

**Files**: `apps/web/src/components/MainPage.tsx`
**Complexity**: Low (1-2 hours)

---

### 2. Max Retry Updates Corrupt Workflow Data
**Spec**: `fix-max-retry-updateworkflow-method.md`
**Status**: FIXED (2026-01-21)
**Problem**: When max retries exceeded, code uses `updateWorkflow({...} as any)` at lines 82-85. This sets ALL workflow fields (title, cron, next_run_timestamp, task_id) to undefined/null.

**Fix Applied**:
1. In workflow-scheduler.ts lines 82-85, replaced `updateWorkflow({...} as any)` with `updateWorkflowFields()`
2. Now only passes `id` and `status` fields
3. Removed the `as any` cast
4. Verified workflow fields remain intact during max retry scenarios

**Files**: `packages/agent/src/workflow-scheduler.ts`
**Complexity**: Low (30 min)

---

### 3. Save.ts Race Condition on Workflow Update
**Spec**: `save-ts-atomic-workflow-update.md`
**Status**: FIXED (2026-01-21)
**Problem**: `save.ts` uses spread pattern `{...workflow, ...}` at lines 69-73 which can overwrite concurrent changes (e.g., user pauses workflow between fetch and update).

**Fix Applied**:
1. In `packages/agent/src/ai-tools/save.ts` lines 69-73, replaced `updateWorkflow({...workflow, ...})` with `updateWorkflowFields()`
2. Now only passes specific fields being changed: `maintenance`, `next_run_timestamp`
3. Prevents concurrent modification race conditions

**Files**: `packages/agent/src/ai-tools/save.ts`
**Complexity**: Low (30 min)

---

### 4. Max Retry State Deletion Order Bug
**Spec**: `fix-max-retry-state-deletion-order.md`
**Status**: FIXED (2026-01-21)
**Problem**: Retry state deleted at line 80 BEFORE DB update at lines 82-85. If DB update fails, workflow enters limbo state (no retry state, status never updated).

**Fix Applied**:
1. In workflow-scheduler.ts, moved line 80 (`this.workflowRetryState.delete(...)`) to AFTER successful database update (combined with #3 save.ts changes)
2. Wrapped DB update in proper try-catch
3. Added error handling to preserve retry state if update fails
4. Verified recovery behavior in DB failure scenarios

**Files**: `packages/agent/src/workflow-scheduler.ts`
**Complexity**: Low (1 hour)

---

### 5. Set Iteration Delete Bug (Memory Leak)
**Spec**: `fix-set-iteration-delete-bug.md`
**Status**: FIXED (2026-01-21)
**Problem**: `clearWorkflowNotifications()` at lines 165-172 deletes from Set while iterating. Undefined behavior in JS - entries may be skipped.

**Fix Applied**:
1. In `apps/web/src/lib/WorkflowNotifications.ts`, updated `clearWorkflowNotifications()` at line 165
2. Now collects keys to delete into array first: `const keysToDelete = [...this.notifiedWorkflows].filter(k => k.startsWith(...))`
3. Deletes after iteration: `keysToDelete.forEach(k => this.notifiedWorkflows.delete(k))`
4. Verified all notifications are properly cleared without skip errors

**Files**: `apps/web/src/lib/WorkflowNotifications.ts`
**Complexity**: Low (30 min)

---

### 6. Test Run Endpoint Blocks for 5 Minutes
**Spec**: `test-run-async-response.md`
**Status**: FIXED (2026-01-21)
**Problem**: `/api/workflow/test-run` at lines 1625-1636 blocks HTTP connection for up to 5 minutes waiting for `executePromise`. Ties up server resources and causes timeout errors.

**Fix Applied**:
1. Changed test-run endpoint to return HTTP 202 immediately with the script run ID
2. The workflow execution now runs in the background with `.then()/.catch()` handlers for logging
3. Client can view run status via existing UI mechanisms (local CR-SQLite syncs automatically)
4. Removed blocking await from test-run endpoint

**Files**: `apps/server/src/server.ts` (test-run endpoint)
**Complexity**: Medium (3-4 hours)
**Dependencies**: #7 (test-run-id-upfront)

---

### 7. Test Run ID Race Condition
**Spec**: `test-run-id-upfront.md`
**Status**: FIXED (2026-01-21)
**Problem**: Test-run at lines 1640-1641 queries for "latest" run after execution. Concurrent test runs could return wrong run ID.

**Fix Applied**:
1. Added optional `scriptRunId` parameter to `executeWorkflow()` method in workflow-worker.ts
2. Added optional `providedScriptRunId` parameter to `processWorkflowScript()` method
3. If ID is provided, it uses that; otherwise generates one (backward compatible)
4. Server endpoint now generates the ID upfront using `generateId()` from "ai" package and passes it to executeWorkflow
5. Returns the known run ID directly without querying for "latest"

**Files**: `packages/agent/src/workflow-worker.ts`, `apps/server/src/server.ts`
**Complexity**: Low (1 hour)

---

## P1 - HIGH PRIORITY (Major Impact)

### 8. Active Script Version Pointer (Architectural Fix)
**Spec**: `active-script-version-pointer.md`
**Status**: FIXED (2026-01-21)
**Problem**: No `active_script_id` column in workflows table. Still uses `getLatestScriptByWorkflowId()` which causes: duplicate content on rollback, inflated version numbers, race conditions, double-click creates duplicates.

**Fix Applied**:
1. Created migration v26.ts adding `active_script_id TEXT NOT NULL DEFAULT ''` to workflows table
2. Migration backfills existing workflows with their latest script ID using correlated subquery
3. Updated Workflow interface to include `active_script_id` field
4. Updated all SQL queries (getWorkflow, listWorkflows, etc.) to include active_script_id
5. Updated updateWorkflowFields() to support active_script_id updates
6. Updated workflow-worker.ts to use `workflow.active_script_id` instead of querying latest
7. Renamed `useRollbackScript` to `useActivateScriptVersion` - now just updates pointer, no script duplication
8. Updated WorkflowDetailPage.tsx:
   - Changed "Current" badge to "Active"
   - Changed "Rollback" button to "Activate"
   - Shows script from workflow.active_script_id
9. Updated save.ts to set active_script_id when new script is saved

**Benefits**:
- No duplicate script content on version switch
- No version number inflation
- Idempotent operations (double-click safe)
- Better performance (direct ID lookup vs "latest" query)
- No race conditions computing next version

**Files**:
- `packages/db/src/migrations/v26.ts` (new)
- `packages/db/src/database.ts` (import migration)
- `packages/db/src/script-store.ts` (interface, queries, updateWorkflowFields)
- `packages/db/src/api.ts` (workflow creation)
- `packages/agent/src/workflow-worker.ts` (executeWorkflow)
- `packages/agent/src/ai-tools/save.ts` (set active_script_id)
- `apps/web/src/hooks/dbWrites.ts` (useActivateScriptVersion)
- `apps/web/src/components/WorkflowDetailPage.tsx` (UI changes)

**Note**: Supersedes `rollback-script-atomicity.md` and `rollback-script-query-invalidation.md`

---

### 9. Complete Tool Error Classification Migration
**Spec**: `complete-tool-error-classification-migration.md`
**Status**: PARTIAL - Classification exists at worker level, not in tools
**Problem**: ClassifiedError is defined in `errors.ts` and used in `workflow-worker.ts` and `sandbox/api.ts`, but individual tools don't throw classified errors. Error classification happens when catching generic errors, which loses context about the error type (auth vs network vs logic).

**Action Items**:
1. Audit all 40 tools in `packages/agent/src/tools/`
2. For each tool, identify error scenarios and appropriate classification:
   - AUTH: OAuth expired, invalid credentials
   - PERMISSION: Access denied, insufficient scope
   - NETWORK: Connection failed, timeout, 5xx
   - LOGIC: Script bugs, unexpected data
   - INTERNAL: Our bugs
3. Import and use ClassifiedError from `../errors.ts`
4. Document error classification in each tool

**Files**: All 40 files in `packages/agent/src/tools/`
**Complexity**: High (10-14 hours)

---

### 10. Emit Signal on Max Retry Escalation
**Spec**: `emit-signal-on-max-retry-escalation.md`
**Status**: FIXED (2026-01-21)
**Problem**: Max retry exceeded at lines 75-87 doesn't emit signal. No OS notification, no tray badge update. User has no idea their automation is stuck.

**Fix Applied**:
1. Enhanced debug logging in workflow-scheduler.ts to include error context (errorType, error message) when max retries are exceeded
2. Added documentation comment explaining that script_run already has error_type='network' which triggers WorkflowNotifications
3. The database change (workflow.status='error') triggers the web client's notifyTablesChanged → checkWorkflowsNeedingAttention flow
4. This is now consistent with how 'needs_attention' signals are logged

**Note**: The WorkflowNotifications system was already being triggered by database changes (workflows table). The fix ensures consistent logging and documentation of the notification flow.

**Files**: `packages/agent/src/workflow-scheduler.ts`
**Complexity**: Low (1 hour)

---

### 11. Script Diff Library Replacement
**Spec**: `scriptdiff-use-diff-library.md`
**Status**: FIXED (2026-01-21)
**Problem**: Custom LCS has O(n*m) memory (can crash browser on large scripts), tie-breaking bugs, empty string edge cases.

**Fix Applied**:
1. Added `diff` (jsdiff) package to apps/web dependencies
2. Added `@types/diff` to devDependencies for TypeScript support
3. Replaced custom LCS algorithm with `diffLines()` from the diff library (Myers algorithm)
4. Added MAX_DIFF_LINES (50,000) safety check to prevent browser crashes on extremely large files
5. Updated computeDiff() to use the library's output format while preserving existing UI

**Benefits**:
- Uses battle-tested Myers diff algorithm instead of O(n*m) LCS
- Better memory characteristics for large files
- Handles edge cases (empty strings, trailing newlines) correctly
- Simpler, more maintainable code

**Files**: `apps/web/src/components/ScriptDiff.tsx`, `apps/web/package.json`
**Note**: Supersedes `scriptdiff-empty-string-handling.md`, `scriptdiff-lcs-tiebreaking.md`

---

### 12. Authentication System (4 specs)

#### 12a. Auth Need Flag
**Spec**: `auth-need-auth-flag.md`
**Status**: NOT IMPLEMENTED
**Problem**: No system-wide flag for LLM access unavailable. Scheduler doesn't pause when auth fails.

**Action Items**:
1. Add `needAuth` key to agent_state table (use existing key-value pattern)
2. Set `needAuth=true` when OpenRouter returns 401/403 or API key missing
3. TaskScheduler/WorkflowScheduler check flag before processing
4. Clear flag when API key is successfully validated
5. Create `useNeedAuth()` hook for web app

**Files**:
- `packages/db/src/api.ts` (add get/setNeedAuth methods)
- `packages/agent/src/task-scheduler.ts`
- `packages/agent/src/workflow-scheduler.ts`
- `apps/server/src/server.ts`
- `apps/web/src/hooks/useNeedAuth.ts` (new)

#### 12b. Auth Popup with Clerk Hash
**Spec**: `auth-popup-clerk-hash.md`
**Status**: NOT IMPLEMENTED
**Problem**: AuthDialog is full-page blocking, no dismiss option.

**Action Items**:
1. Create `AuthPopup.tsx` as dismissable modal
2. Configure Clerk for hash-based routes (`/#/signup`, `/#/signin`)
3. Handle modal show/hide based on URL hash
4. Replace AuthDialog usage with AuthPopup

**Files**:
- `apps/web/src/components/AuthPopup.tsx` (new)
- `apps/web/src/App.tsx`

#### 12c. Auth Header Notice
**Spec**: `auth-header-notice.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. Create `HeaderAuthNotice.tsx` component (warning icon)
2. Add to SharedHeader, shown when `needAuth=true`
3. Click opens AuthPopup

**Files**:
- `apps/web/src/components/HeaderAuthNotice.tsx` (new)
- `apps/web/src/components/SharedHeader.tsx`

#### 12d. Auth Chat Event Item
**Spec**: `auth-chat-event-item.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. Create `AuthEventItem.tsx` for chat display
2. Show in chat when `needAuth=true`
3. Auto-show popup on page load if needAuth

**Files**:
- `apps/web/src/components/AuthEventItem.tsx` (new)
- `apps/web/src/components/ChatInterface.tsx`

**Total Complexity**: High (6-8 hours for all 4)

---

### 13. Pause All Workflows SQL Optimization
**Spec**: `pause-all-workflows-sql.md`
**Status**: FIXED (2026-01-21)
**Problem**: Pause-all in App.tsx lines 82-109 fetches then updates one-by-one. Slow, race conditions, 100 workflow limit.

**Fix Applied**:
1. Added pauseAllWorkflows() method to script-store.ts
2. Uses single atomic SQL UPDATE for all active workflows
3. Returns count of paused workflows
4. Updated App.tsx to use the new method instead of the loop

**Files**: `packages/db/src/script-store.ts`, `apps/web/src/App.tsx`
**Complexity**: Medium (2-3 hours)

### 14. Database Indexes
**Specs**: `script-runs-workflow-id-index.md`, `script-runs-retry-of-index.md`
**Status**: FIXED (2026-01-21)
**Problem**: Query performance issues on script_runs table.

**Fix Applied**:
1. Created migration v25.ts in packages/db/src/migrations/
2. Added index on `workflow_id` column: `CREATE INDEX IF NOT EXISTS idx_script_runs_workflow_id ON script_runs(workflow_id)`
3. Added index on `retry_of` column: `CREATE INDEX IF NOT EXISTS idx_script_runs_retry_of ON script_runs(retry_of)`
4. Registered migration in database.ts

**Files**:
- `packages/db/src/migrations/v25.ts` (new)
- `packages/db/src/database.ts` (import and register migration)

**Complexity**: Low (1 hour)

---

### 15. Maintenance Event Types Registration
**Spec**: `maintenance-event-types-registration.md`
**Status**: FIXED (2026-01-21)
**Problem**: `maintenance_started` and `maintenance_escalated` events weren't in EVENT_TYPES - causes UI rendering issues.

**Fix Applied**:
- Added MAINTENANCE_STARTED, MAINTENANCE_ESCALATED, MAINTENANCE_FIXED to EVENT_TYPES
- Added payload interfaces for each type
- Added EVENT_CONFIGS entries with appropriate emojis and significance levels:
  - maintenance_started: wrench emoji, 'state' significance
  - maintenance_escalated: warning emoji, 'error' significance
  - maintenance_fixed: checkmark emoji, 'success' significance
- Events now render properly in the timeline with navigation to workflow page

**Files**: `apps/web/src/types/events.ts` (or similar)
**Complexity**: Low (1 hour)
---

### 16. Workflow Timestamp Bug
**Spec**: `workflow-timestamp-as-creation-time.md`
**Status**: FIXED (2026-01-21)
**Problem**: UI shows "Created" but scheduler updates timestamp on EVERY execution at 4 places: lines 275, 284, 293, 300.

**Fix Applied**:
1. In workflow-worker.ts lines 187-193, removed timestamp update that was incorrectly marking "last successful run"
2. In workflow-scheduler.ts, removed `timestamp: currentTimeISO` updates from 4 places (lines 280, 289, 298, 305) where it was corrupting the creation timestamp
3. Added comments explaining that workflow.timestamp is the creation time, script_runs table tracks execution times, and next_run_timestamp is used for scheduling

**Files**: `packages/agent/src/workflow-worker.ts`, `packages/agent/src/workflow-scheduler.ts`
**Complexity**: Low (1 hour)

---

### 17. Legacy Error Type Notification Handling
**Spec**: `legacy-error-type-notification-handling.md`
**Status**: FIXED (2026-01-21)
**Problem**: Empty error_type handled differently between MainPage and WorkflowNotifications.

**Fix Applied**:
1. Added empty string ('') to NOTIFY_ERROR_TYPES array in WorkflowNotifications.ts
2. Now legacy/unclassified errors will trigger OS notifications, matching MainPage behavior
3. Added comment explaining the purpose

**Files**: `apps/web/src/lib/WorkflowNotifications.ts`
**Complexity**: Low (30 min)

---

### 18. Electron Window Ready Promise Rejection
**Spec**: `electron-window-ready-promise-rejection.md`
**Status**: FIXED (2026-01-21)
**Problem**: `ensureWindowReady()` at lines 100-119 creates promise that hangs forever if window closes.

**Fix Applied**:
1. Added windowReadyReject alongside windowReadyResolve
2. Promise now rejects with "Window was closed" error when window closes
3. Added try-catch to all ensureWindowReady() callers

**Files**: `apps/electron/src/main.ts`
**Complexity**: Medium (2 hours)

---

### 19. Service Worker Update Detection
**Spec**: `service-worker-update-detection.md`
**Status**: NEEDS VERIFICATION
**Problem**: May check `activated` state but controller might be old. Possible false positives/negatives.

**Action Items**:
1. Verify current implementation in main.tsx
2. Listen to `controllerchange` event instead if needed
3. Remove `statechange` handler for update detection if redundant
4. Test: Update service worker, verify banner appears correctly

**Files**: `apps/web/src/main.tsx`
**Complexity**: Medium (2 hours)

---

### 20. Notification Grouping for Batch Errors
**Spec**: `notification-grouping-batch-errors.md`
**Status**: NOT IMPLEMENTED
**Problem**: Each workflow error produces individual OS notification = notification spam.

**Action Items**:
1. Collect errors per check interval (e.g., 30 seconds)
2. Group by error type: "3 workflows need authentication"
3. Single notification per type, not per workflow
4. Include workflow names in notification body

**Files**: `apps/web/src/lib/WorkflowNotifications.ts`
**Complexity**: High (6-8 hours)

---

### 21. IN Clause Length Limits
**Spec**: `in-clause-length-limits.md`
**Status**: FIXED (2026-01-21)
**Problem**: Array inputs to SQL IN clauses not validated for length. Could cause resource exhaustion.

**Fix Applied**:
1. Added MAX_IN_CLAUSE_LENGTH = 1000 constant in interfaces.ts
2. Added validateInClauseLength() helper function
3. Updated all 5 affected methods:
   - script-store.ts: getLatestRunsByWorkflowIds()
   - task-store.ts: getTasks(), getStates()
   - file-store.ts: getFiles()
   - nostr-peer-store.ts: deletePeers()
4. Clear error messages when limit exceeded

**Files**:
- `packages/db/src/interfaces.ts`
- `packages/db/src/script-store.ts`
- `packages/db/src/task-store.ts`
- `packages/db/src/file-store.ts`
- `packages/db/src/nostr-peer-store.ts`

**Complexity**: Medium (3-4 hours)

---

## P2 - MEDIUM PRIORITY (Quality & UX)

### 22. MainPage Autonomy Toggle Positioning
**Spec**: `mainpage-autonomy-toggle-positioning.md`
**Status**: CONFIRMED - toggle is outside toolbar

**Action Items**:
1. Move toggle inside input toolbar
2. Position right of + button
3. Adjust styling for toolbar context

**Files**: `apps/web/src/components/MainPage.tsx`
**Complexity**: Low (1 hour)

---

### 23. MainPage Type Safety Issues
**Status**: NEW ISSUE
**Problem**: Uses `Record<string, any>` for latestRuns at 3 places (lines 160, 181, 201). Type safety issue allowing runtime errors.

**Action Items**:
1. Define proper `ScriptRun` type import
2. Replace `Record<string, any>` with `Record<string, ScriptRun>`
3. Add proper typing throughout the file

**Files**: `apps/web/src/components/MainPage.tsx`
**Complexity**: Low (30 min)

---

### 24. Extract Auto-Hiding Message Hook
**Spec**: `extract-auto-hiding-message-hook.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. Create `useAutoHidingMessage()` hook in shared location
2. Handle: state, setTimeout, cleanup, clear functions
3. Update 4 components to use hook
4. Remove duplicated ~100 lines

**Files**:
- `apps/web/src/hooks/useAutoHidingMessage.ts` (new)
- `apps/web/src/components/WorkflowEventGroup.tsx`
- `apps/web/src/components/ScriptDetailPage.tsx`
- `apps/web/src/components/TaskDetailPage.tsx`
- `apps/web/src/components/WorkflowDetailPage.tsx`

**Complexity**: Medium (3-4 hours)

---

### 25. Reduce Event Group Duplication
**Spec**: `reduce-event-group-duplication.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. Identify shared logic between TaskEventGroup and WorkflowEventGroup
2. Extract to shared component or hook
3. ~75 lines of deduplication potential

**Files**:
- `apps/web/src/components/TaskEventGroup.tsx`
- `apps/web/src/components/WorkflowEventGroup.tsx`

**Complexity**: High (6-8 hours)

---

### 26. Complete StatusBadge Consolidation
**Spec**: `complete-statusbadge-consolidation.md`
**Status**: 84% DONE

**Action Items**:
1. Create ScriptRunStatusBadge component
2. Update remaining inline badge logic in TaskDetailPage
3. Ensure consistent styling across all pages

**Files**:
- `apps/web/src/components/ui/ScriptRunStatusBadge.tsx` (new)
- `apps/web/src/components/TaskDetailPage.tsx`

**Complexity**: Medium (3-4 hours)

---

### 27. Complete AutonomyMode Type Consolidation
**Spec**: `complete-autonomymode-consolidation.md`
**Status**: FIXED (2026-01-21)

- Updated packages/db/src/api.ts to import AutonomyMode from @app/proto
- Updated packages/agent/src/task-worker.ts to import AutonomyMode from @app/proto
- Replaced all inline 'ai_decides' | 'coordinate' type annotations with AutonomyMode type

**Complexity**: Low (30 min)

---

### 28. Remove parseAsks Re-export
**Spec**: `remove-parseasks-reexport.md`
**Status**: FIXED (2026-01-21)

- Removed re-export line from packages/agent/src/ai-tools/ask.ts
- Removed re-export from packages/agent/src/index.ts
- Verified no imports were using parseAsks/StructuredAsk from @app/agent (all already use @app/proto)

**Complexity**: Low (30 min)

---

### 29. Chat Scroll Position Save Cleanup
**Spec**: `chat-scroll-position-save-cleanup.md`
**Status**: DEAD CODE STILL PRESENT

**Action Items**:
1. Add React Router's `<ScrollRestoration />` component
2. Remove manual sessionStorage scroll save code
3. Remove dead `handleBeforeUnload` function

**Files**: `apps/web/src/App.tsx`, `apps/web/src/components/ChatInterface.tsx`
**Complexity**: Medium (2-3 hours)

---

### 30. Rollback Script Query Invalidation
**Spec**: `rollback-script-query-invalidation.md`
**Status**: SUPERSEDED by #8 (2026-01-21)
**Note**: The `useActivateScriptVersion` hook (which replaced `useRollbackScript`) now properly invalidates both workflow queries and script queries in its onSuccess callback. No additional changes needed.

**Files**: `apps/web/src/hooks/dbWrites.ts`

---

### 31. Pause All User Feedback
**Spec**: `pause-all-user-feedback.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. After pause-all completes, show toast notification
2. Include count: "Paused N workflows"
3. Consider using existing notification system

**Files**: `apps/web/src/App.tsx`
**Complexity**: Medium (2-3 hours)

---

### 32. Workflow Notifications Internal Error
**Spec**: `workflow-notifications-internal-error.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Added 'internal' to NOTIFY_ERROR_TYPES array in WorkflowNotifications.ts
2. Internal errors (bugs in our code) now trigger OS notifications so users are aware
3. Added comment explaining internal errors

**Files**: `apps/web/src/lib/WorkflowNotifications.ts`
**Complexity**: Low (30 min)

---

### 33. Payment Required Error Type
**Spec**: `payment-required-error-type.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Verify current handling of ERROR_PAYMENT_REQUIRED
2. Set proper errorType for payment errors
3. Use 'auth' or create new 'payment' type as appropriate

**Files**: `packages/agent/src/workflow-worker.ts`
**Complexity**: Low (30 min)

---

### 34. Maintenance Fixed Event Chat Routing
**Spec**: `maintenance-fixed-event-chat-routing.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Updated save.ts to use `opts.chatId` instead of hardcoded "main" for maintenance_fixed event
2. Now matches pattern used by maintenance_started event
3. Ensures events are routed to correct chat

**Files**: `packages/agent/src/ai-tools/save.ts`
**Complexity**: Low (30 min)

---

### 35. Electron IPC Error Handling
**Spec**: `electron-ipc-error-handling.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Added consistent try-catch to all IPC handlers (app:getVersion, open-external, update-tray-badge)
2. Handlers now return success/failure indicators
3. Errors are logged via debugMain

**Files**: `apps/electron/src/main.ts`
**Complexity**: Medium (2-3 hours)

---

### 36. Electron Notification Click Error Handling
**Spec**: `electron-notification-click-error-handling.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Added try-catch around ensureWindowReady() in notification click handler
2. Errors are logged and don't crash the app

**Files**: `apps/electron/src/main.ts`
**Complexity**: Low (15 min)

---

### 37. Electron Icon Creation Error Handling
**Spec**: `electron-icon-creation-error-handling.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Wrapped SVG icon creation in try-catch
2. Returns nativeImage.createEmpty() on failure
3. Errors are logged for debugging

**Files**: `apps/electron/src/main.ts`
**Complexity**: Low (15 min)

---

### 38. Test Run Single Concurrent
**Spec**: `test-run-single-concurrent.md`
**Status**: NOT IMPLEMENTED

**Action Items**:
1. Track running test per workflow_id
2. Reject concurrent requests for same workflow
3. Return existing run_id or error

**Files**: `apps/server/src/server.ts`
**Complexity**: Low (1 hour)

---

### 39. Pause All Ensure Window Ready
**Spec**: `pause-all-ensure-window-ready.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
1. Added ensureWindowReady() call before sending pause-all IPC message
2. Wrapped in try-catch like other tray menu handlers

**Files**: `apps/electron/src/main.ts`
**Complexity**: Low (15 min)

---

### 40. MainPage Input Positioning
**Spec**: `mainpage-input-positioning.md`
**Status**: NOT VERIFIED

**Action Items**:
1. When workflows exist: position input at top
2. When empty: center input vertically
3. Use conditional CSS/layout based on workflow count

**Files**: `apps/web/src/components/MainPage.tsx`
**Complexity**: Medium (3-4 hours)

---

### 41. MainPage Suggestion Focus
**Spec**: `mainpage-suggestion-focus-textarea.md`
**Status**: NOT VERIFIED

**Action Items**:
1. After clicking suggestion button, call `inputRef.focus()`
2. Optionally position cursor at end of text

**Files**: `apps/web/src/components/MainPage.tsx`
**Complexity**: Low (1 hour)

---

### 42. Quick Reply Double-Click Prevention
**Spec**: `quick-reply-double-click-prevention.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add local disabled state to quick reply buttons
2. Disable immediately on click
3. Re-enable after mutation completes

**Files**: `apps/web/src/components/ChatPage.tsx`
**Complexity**: Low (1 hour)

---

### 43. Script Run Retry Link Script Mismatch
**Spec**: `script-run-retry-link-script-mismatch.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Query original run's script_id
2. Use that for retry navigation link instead of current run's

**Files**: `apps/web/src/components/ScriptRunDetailPage.tsx`
**Complexity**: Medium (2 hours)

---

### 44. ScriptDiff Find Version By Number
**Spec**: `scriptdiff-find-version-by-number.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Find previous version by version number, not array index
2. Prevents issues if versions are not contiguous

**Files**: `apps/web/src/components/WorkflowDetailPage.tsx`
**Complexity**: Low (30 min)

---

### 45. Tray Badge Count Accuracy
**Spec**: `tray-badge-count-accuracy.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Align tray badge count with notification-eligible workflows
2. Decide: count all attention-needing OR only notifiable errors
3. Document the decision

**Files**: `apps/web/src/lib/WorkflowNotifications.ts`
**Complexity**: Medium (2-3 hours)

---

### 46. Cost Tracking Helper
**Spec**: `cost-tracking-helper.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Create helper function for type-safe cost tracking
2. Prevents passing wrong format to tool events
3. Use in all tools that track costs

**Files**: `packages/agent/src/tools/` (multiple)
**Complexity**: Medium (2-3 hours)

---

### 47. Focus Input URL Param
**Spec**: `focus-input-url-param.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Replace custom event + setTimeout with URL query parameter
2. Check for `?focus=input` on mount
3. Focus input and clear param

**Files**: `apps/web/src/App.tsx`, `apps/web/src/components/MainPage.tsx`
**Complexity**: Medium (2 hours)

---

## P3 - LOW PRIORITY (Polish)

### 48. Code Quality: `as any` Type Casts
**Status**: NEW ISSUE
**Problem**: 58 occurrences of `as any` across 25 files. Type safety issues.

**Action Items**:
1. Audit all `as any` usages
2. Replace with proper types where possible
3. Document remaining intentional casts

**Files**: Multiple (see grep results)
**Complexity**: Medium (4-6 hours)

---

### 49. Code Quality: FIXME Comments
**Status**: NEW ISSUE
**Problem**: 4 FIXME comments in sync code needing attention.

**Files**:
- `packages/db/src/migrations/v23.ts` - MessageNotifications issue
- `packages/sync/src/TransportClientHttp.ts` - Node.js implementation missing
- `packages/sync/src/Peer.ts` - TX delivery organization
- `packages/sync/src/nostr/stream/StreamWriter.ts` - Bandwidth number

**Complexity**: Medium (2-4 hours per FIXME)

---

### 50. Code Quality: Skipped Tests
**Status**: NEW ISSUE
**Problem**: 6 skipped tests due to environment constraints.

**Files**:
- `packages/tests/src/exec-many-args-browser.test.ts`
- `packages/tests/src/nostr-transport-sync.test.ts`
- `packages/tests/src/crsqlite-peer-new.test.ts`
- `packages/tests/src/file-transfer.test.ts`
- `packages/tests/src/nostr-transport.test.ts` (2 tests)

**Complexity**: High (varies by test)

---

### 51. MainPage Autonomy Tooltip Styling
**Spec**: `mainpage-autonomy-tooltip-styling.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add solid background to tooltip
2. Left-align text
3. Remove arrow if present

**Files**: `apps/web/src/components/ui/tooltip.tsx`, `apps/web/src/components/MainPage.tsx`
**Complexity**: Low (30 min)

---

### 52. TaskEventGroup Header Refactor
**Spec**: `taskeventgroup-header-refactor.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Extract inline HeaderContent component to module scope
2. Prevents recreation on every render

**Files**: `apps/web/src/components/TaskEventGroup.tsx`
**Complexity**: Low (1 hour)

---

### 53. Mermaid Diagram useMemo
**Spec**: `mermaid-diagram-usememo.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Wrap mermaid markdown string creation in useMemo
2. Makes Response component memo effective

**Files**: `apps/web/src/components/WorkflowDetailPage.tsx`
**Complexity**: Trivial (10 min)

---

### 54. SharedHeader Debug Mode Memoize
**Spec**: `shared-header-debug-mode-memoize.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Memoize localStorage read for debug mode
2. Use useMemo or state instead of reading every render

**Files**: `apps/web/src/components/SharedHeader.tsx`
**Complexity**: Low (30 min)

---

### 55. Chat ResizeObserver Height Reference
**Spec**: `chat-resizeobserver-height-reference.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Use consistent DOM reference for height comparison
2. Use `document.documentElement.scrollHeight`

**Files**: `apps/web/src/components/ChatInterface.tsx`
**Complexity**: Low (30 min)

---

### 56. localStorage Error Handling
**Spec**: `localstorage-error-handling.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Wrap localStorage access in try-catch
2. Handle incognito mode gracefully
3. Provide fallback values

**Files**: Multiple (audit localStorage usage)
**Complexity**: Low (1 hour)

---

### 57. setTimeout Cleanup Remaining Components
**Spec**: `settimeout-cleanup-remaining-components.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Fix setTimeout cleanup in FilesPage.tsx
2. Fix setTimeout cleanup in QueryProvider.tsx
3. Clear timeouts on unmount

**Files**: `apps/web/src/components/FilesPage.tsx`, `apps/web/src/QueryProvider.tsx`
**Complexity**: Low (1 hour)

---

### 58. App Update Banner Timeout Cleanup
**Spec**: `app-update-banner-timeout-cleanup.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add setTimeout cleanup for auto-dismiss
2. Clear on component unmount

**Files**: `apps/web/src/App.tsx`
**Complexity**: Low (30 min)

---

### 59. App Update Banner Reload Button
**Spec**: `app-update-banner-reload-button.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
Added "Reload" button to AppUpdateBanner that calls window.location.reload()

**Files**: `apps/web/src/App.tsx` (AppUpdateBanner component)
**Complexity**: Trivial (15 min)

---

### 60. App Update Banner Z-Index
**Spec**: `app-update-banner-z-index.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
Changed z-index from z-50 to z-[60] to appear above modal dialogs

**Files**: `apps/web/src/App.tsx`
**Complexity**: Trivial (5 min)

---

### 61. Script Run Detail Test Badge
**Spec**: `script-run-detail-test-badge.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add test badge to ScriptRunDetailPage header
2. Show when run.type === 'test'

**Files**: `apps/web/src/components/ScriptRunDetailPage.tsx`
**Complexity**: Trivial (10 min)

---

### 62. Workflow Detail Clear Success on Warning
**Spec**: `workflow-detail-clear-success-on-warning.md`
**Status**: FIXED (2026-01-21)

**Fix Applied**:
Added setSuccessMessage("") to showWarning() function to clear success message when showing warning

**Files**: `apps/web/src/components/WorkflowDetailPage.tsx`
**Complexity**: Trivial (5 min)

---

### 63. CodeBlock Timeout Null Assignment
**Spec**: `codeblock-timeout-null-assignment.md`
**Status**: ALREADY FIXED

**Fix Applied**:
Verified that copyTimeoutRef.current = null is already present in the timeout callback at line 146

**Files**: `apps/web/src/components/ui/code-block.tsx`
**Complexity**: Trivial (5 min)

---

### 64. Quick Reply Option Length Validation
**Spec**: `quick-reply-option-length-validation.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Truncate option text to max length (50-100 chars)
2. Add ellipsis if truncated

**Files**: `packages/agent/src/ai-tools/ask.ts` or UI component
**Complexity**: Low (1 hour)

---

### 65. Streamdown Tailwind Source
**Spec**: `streamdown-tailwind-source.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add Streamdown distribution files to Tailwind content sources
2. Ensures CSS classes from Streamdown are included

**Files**: `apps/web/tailwind.config.js`
**Complexity**: Low (30 min)

---

### 66. Standardize Debug Version
**Spec**: `standardize-debug-version.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Update all packages to use `debug: ^4.4.3`
2. Run npm install to align versions

**Files**: Multiple `package.json` files
**Complexity**: Trivial (15 min)

---

### 67. Add @types/debug Dependency
**Spec**: `add-types-debug-dependency.md`
**Status**: NOT VERIFIED

**Action Items**:
1. Add `@types/debug` to apps/web devDependencies

**Files**: `apps/web/package.json`
**Complexity**: Trivial (5 min)

---

## IDEAS TO PROMOTE TO SPECS

Based on analysis of `ideas/*`, these should become formal specs for v1:

### 68. Detect Abandoned Drafts
**Idea**: `ideas/detect-abandoned-drafts.md`
**Status**: PROMOTE TO SPEC
**Rationale**: Foundation for draft management system

**Action Items**:
1. Add `getAbandonedDrafts()` method to ScriptStore
2. Query draft workflows with no activity for X days (3/7/30 thresholds)
3. Calculate "last activity" from chat events, script saves, workflow updates
4. Add `getDraftActivitySummary()` for UI display

**Files**: `packages/db/src/script-store.ts`
**Complexity**: Medium (3-4 hours)

---

### 69. Prompt Stale Drafts
**Idea**: `ideas/prompt-stale-drafts.md`
**Status**: PROMOTE TO SPEC
**Rationale**: User engagement improvement
**Dependencies**: #68 (Detect Abandoned Drafts)

**Action Items**:
1. Add amber banner component to MainPage
2. Show "You have X drafts waiting" when drafts exist
3. "View" navigates to oldest draft
4. "Dismiss" hides banner, cooldown in localStorage (7 days)
5. 24-hour suppression after interacting with any draft

**Files**:
- `apps/web/src/components/StaleDraftsBanner.tsx` (new)
- `apps/web/src/components/MainPage.tsx`

**Complexity**: Medium (3-4 hours)

---

### 70. Highlight Significant Events
**Idea**: `ideas/highlight-significant-events.md`
**Status**: PROMOTE TO SPEC
**Rationale**: High UX impact with small effort

**Action Items**:
1. Add color coding to chat events by significance:
   - Red: errors, failures
   - Green: fixes, completions
   - Blue: user interactions
   - Yellow: state changes, maintenance
2. Update EventItem component with color variants

**Files**:
- `apps/web/src/components/EventItem.tsx`
- `apps/web/src/types/events.ts`

**Complexity**: Medium (3-4 hours)

---

### 71. Collapse Low-Signal Events
**Idea**: `ideas/collapse-low-signal-events.md`
**Status**: PROMOTE TO SPEC
**Rationale**: High UX impact - reduces chat noise
**Pairs with**: #70 (Highlight Significant Events)

**Action Items**:
1. Classify events by signal level (high/low)
2. Auto-collapse routine events into summary: "5 routine events"
3. Keep errors, writes, user interactions visible
4. Click to expand collapsed group

**Files**:
- `apps/web/src/components/ChatInterface.tsx`
- `apps/web/src/components/EventGroup.tsx` (new or modify existing)

**Complexity**: Medium (3-4 hours)

---

## Summary Statistics

| Priority | Count | Est. Hours |
|----------|-------|------------|
| P0 Critical | 7 | 10-14 |
| P1 High | 14 | 45-60 |
| P2 Medium | 26 | 35-50 |
| P3 Low | 20 | 12-18 |
| Ideas->Specs | 4 | 12-16 |
| **Total** | **71** | **114-158** |

**Changes from previous version**:
- Removed: #2 (Enter key - was symptom of #1), #20 (Electron notification return type - already correct)
- Added: #23 (MainPage type safety), #48-50 (code quality issues)
- Updated: #31 parseAsks re-export (NOT fixed, still present)
- Updated: #9 tool error classification (0% done, not 18%)
- Renumbered all items for consistency

---

## Recommended Implementation Order

### Week 1: Core Functionality (P0)
1. #1 MainPage submission broken - **HIGHEST PRIORITY**
2. #2 Max retry corrupts workflow
3. #3 Save.ts race condition
4. #4 Max retry state deletion order
5. #5 Set iteration delete bug

### Week 2: Data Integrity & Testing (P0 + P1)
6. #6 Test run async response
7. #7 Test run ID upfront
8. #8 Active script version pointer
9. #14 Database indexes
10. #16 Workflow timestamp fix

### Week 3: Error Handling & Notifications (P1)
11. #9 Complete tool error classification
12. #10 Emit signal on max retry
13. #11 Script diff library
14. #17 Legacy error type handling
15. #20 Notification grouping

### Week 4: Auth & UX (P1 + P2)
16. #12a-d Auth system (4 parts)
17. #13 Pause all SQL
18. #15 Maintenance event types
19. #18-19 Electron fixes
20. #22-23 MainPage improvements

### Week 5+: Polish & Remaining (P2 + P3)
- Code quality items (#48-50)
- UI polish
- Performance optimizations
- Ideas promotion (#68-71)
