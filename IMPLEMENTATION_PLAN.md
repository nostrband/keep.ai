# Implementation Plan

Generated: 2026-01-19

This document prioritizes tasks for achieving a simple, lovable, and complete v1 release of Keep.AI - a local personal automation product with AI-powered automation creation and maintenance.

---

## Priority P0 - Critical (Bugs, Data Corruption Risks)

### 1. workflow-state-consistency.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: M
- **Description**: Fix concurrent update issues where stale workflow objects overwrite concurrent changes. The scheduler uses `{ ...workflow, field: value }` spread pattern after execution, potentially overwriting user changes (e.g., user pauses while workflow is running).
- **Files**: `packages/agent/src/workflow-scheduler.ts`, `packages/agent/src/workflow-worker.ts`
- **Resolution**: Added `updateWorkflowFields()` method to `script-store.ts` for atomic partial updates. Updated `workflow-scheduler.ts` and `workflow-worker.ts` to use `updateWorkflowFields()` instead of spread pattern. This prevents concurrent updates (like user pausing) from being overwritten by stale workflow objects.

### 2. network-error-max-retries.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: Network errors retry indefinitely with exponential backoff capped at 10 minutes. NO max retry limit exists - causes infinite retries. Need max retry limit to escalate to user attention.
- **Files**: `packages/agent/src/workflow-scheduler.ts`
- **Resolution**: Added `MAX_NETWORK_RETRIES = 5` constant to `WorkflowScheduler`. Modified retry handler to check retry count and escalate to user attention when exceeded. Workflow is marked as 'error' status when max retries exceeded. Retry state is cleared when escalating.

### 3. fix-electron-navigation-handler-cleanup.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: Memory leak in App.tsx - `navigate` in useEffect dependencies causes new IPC listeners on each render. Uses `removeAllListeners` pattern which removes all listeners not just component's own.
- **Files**: `apps/web/src/App.tsx`, `apps/electron/src/preload.ts`, `apps/web/src/vite-env.d.ts`
- **Resolution**: Used `useRef` to hold navigate function and empty dependency array so effect runs only once on mount. Updated preload.ts to return unsubscribe functions from `onNavigateTo`, `onFocusInput`, and `onPauseAllAutomations` instead of relying on `removeAllListeners`. Updated TypeScript types in vite-env.d.ts accordingly. This prevents multiple listeners accumulating and ensures proper cleanup of only this component's listener.

### 4. handle-get-autonomy-mode-error.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: `getAutonomyMode()` call in task-worker.ts has NO try-catch. DB failure crashes task execution instead of falling back to default 'ai_decides' mode.
- **Files**: `packages/agent/src/task-worker.ts`
- **Resolution**: Added try-catch around `getAutonomyMode()` call in `task-worker.ts`. Falls back to 'ai_decides' mode if database query fails. Debug logging added for when fallback is used.

### 5. task-worker-include-tool-costs.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: PARTIAL implementation: task-worker missing `sandbox.context.cost` for tool execution costs. UI (TaskEventGroup) would double-count costs once fixed by summing both taskRun.cost and event costs.
- **Files**: `packages/agent/src/task-worker.ts`, `apps/web/src/components/TaskEventGroup.tsx`
- **Resolution**: Modified `finishTaskRun()` to accept `toolCost` parameter. Combined agent LLM costs with tool execution costs from `sandbox.context.cost`. Updated `TaskEventGroup.tsx` to only use `taskRun.cost` (no longer sums event costs to avoid double-counting).

---

## Priority P1 - Important (Core UX, Error Handling)

### 6. validate-workflow-status-before-retry.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: Retry handler only checks workflow exists, not if status is 'active'. Users get false "Retry scheduled" message for paused/disabled workflows.
- **Files**: `apps/web/src/components/WorkflowEventGroup.tsx`
- **Resolution**: Added status validation in `handleRetry` to check `workflow.status !== 'active'`. Shows "Enable workflow first to retry" message and disables the Retry menu item for non-active workflows. Prevents false positive feedback for retries that would never execute.

### 7. workflow-early-pause.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: M
- **Description**: When user pauses workflow, currently running execution continues until completion. No status check before each tool call - should abort if paused.
- **Files**: `packages/agent/src/sandbox/api.ts`, `packages/agent/src/workflow-worker.ts`, `packages/agent/src/errors.ts`
- **Resolution**: Added `WorkflowPausedError` class in errors.ts for clean abort signaling. Extended `SandboxAPIConfig` to accept optional `workflowId`. Added `checkWorkflowActive()` method in SandboxAPI that checks workflow status before each tool call - throws `WorkflowPausedError` if workflow is no longer active. Updated WorkflowWorker to pass workflowId to SandboxAPI. Special handling for WorkflowPausedError in processWorkflowScript - records as clean "paused" result (not error), signals done to scheduler without retry or error status change.

### 8. fix-next-run-time-status-check.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: Uses negative logic (`disabled || error`) instead of positive (`status === 'active'`) to determine if next run time should display. Edge cases may show incorrect next run time.
- **Files**: `apps/web/src/components/WorkflowDetailPage.tsx`
- **Resolution**: Changed condition from `workflow.status === 'disabled' || workflow.status === 'error'` to `workflow.status !== 'active'`. This aligns UI with scheduler logic - only active workflows show next run time since scheduler only executes where `status === 'active'`.

### 9. internal-error-classification.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: ERROR_BAD_REQUEST gets empty error_type. Need new 'internal' error type for bugs, with "Something went wrong. Please contact support" guidance.
- **Files**: `packages/agent/src/workflow-worker.ts`, `packages/agent/src/errors.ts`, `apps/web/src/components/MainPage.tsx`
- **Resolution**: Added 'internal' to ErrorType union and created InternalError class. Updated workflow-worker.ts to classify ERROR_BAD_REQUEST as 'internal' and emit 'needs_attention' signal. Added 'internal' to ATTENTION_ERROR_TYPES in MainPage.tsx with user-friendly message "Something went wrong - contact support".

### 10. fix-audio-explain-cost-tracking.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: audio-explain tool passes full `usage` object instead of `{ usage: { cost: usage.cost } }`. Costs may not accumulate correctly.
- **Files**: `packages/agent/src/tools/audio-explain.ts`
- **Resolution**: Changed `usage` to `usage: { cost: usage.cost }` in createEvent call, matching the pattern used by all other tools (pdf-explain, images-explain, text-generate, etc.). This ensures audio processing costs are properly tracked.

### 11. electron-window-ready-before-ipc.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: IPC messages sent immediately after createWindow() are lost - window not ready yet. Need to wait for `did-finish-load` event before IPC send.
- **Files**: `apps/electron/src/main.ts`
- **Resolution**: Created `getAppIcon()` helper function that loads icon from file or generates from embedded SVG (matches "K in square" design). Added `ensureWindowReady()` async function that waits for `did-finish-load` event before sending IPC. Updated all handlers (notification click, tray menu, global shortcuts) to use `ensureWindowReady()` before sending IPC messages. Window ready state is tracked via `windowReady` flag and reset when window is closed.

### 12. notification-error-handling.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: Electron notification IPC handler has no try-catch around Notification constructor.
- **Files**: `apps/electron/src/main.ts`
- **Resolution**: Added try-catch around Notification creation and show. Errors are logged via debugMain and handler returns false to indicate failure instead of throwing.

### 13. batch-fetch-workflow-runs.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: M
- **Description**: MainPage and WorkflowNotifications fetch latest runs sequentially in for loops - creates N queries. No batch method exists in scriptStore.
- **Files**: `packages/db/src/script-store.ts`, `apps/web/src/components/MainPage.tsx`, `apps/web/src/lib/WorkflowNotifications.ts`
- **Resolution**: Added `getLatestRunsByWorkflowIds(workflowIds: string[])` method to ScriptStore that fetches latest run for each workflow in a single SQL query using a subquery with `MAX(start_timestamp)` and `GROUP BY workflow_id`. Updated MainPage.tsx to use batch method and added cleanup flag to prevent stale state updates if component unmounts during fetch. Updated WorkflowNotifications.ts to use batch method instead of sequential loop.

### 14. notification-icon.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: `apps/electron/assets/` directory and `icon.png` don't exist. Notifications show missing/default icon. Need 256x256 or 512x512 PNG with "K in square" logo.
- **Files**: Create `apps/electron/assets/icon.png`
- **Resolution**: Added `getAppIcon()` helper function in main.ts that first tries to load from `assets/icon.png` file, then falls back to an embedded SVG icon matching the "K in square" design (golden border #D6A642, white background, black K). Updated createWindow(), Notification, and Tray to use this helper. Removed hardcoded icon paths. Created empty `apps/electron/assets/` directory for future custom icon file.

### 15. tray-menu-ipc-handlers.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: M
- **Description**: Tray menu sends `focus-input` and `pause-all-automations` IPC messages but no React component registers handlers. Also preload pattern doesn't return unsubscribe function (memory leak).
- **Files**: `apps/web/src/App.tsx`, `apps/electron/src/preload.ts`
- **Resolution**: Added `ElectronIPCHandler` component in App.tsx that handles all three IPC events (navigate-to, focus-input, pause-all-automations). For focus-input: dispatches custom event to MainPage which focuses the textarea. For pause-all-automations: iterates over active workflows and sets their status to 'disabled'. Added event listener in MainPage.tsx to handle focus-input custom event. All listeners properly return unsubscribe functions and clean up on unmount. Removed the old `ElectronNavigationHandler` component.

### 16. wire-up-workflow-notifications-methods.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: S
- **Description**: WorkflowNotifications has `clearWorkflowNotifications()` and `reset()` methods but they're never called. `checkIntervalMs` property unused.
- **Files**: `apps/web/src/lib/WorkflowNotifications.ts`, `apps/web/src/components/WorkflowDetailPage.tsx`
- **Resolution**: Added import of `workflowNotifications` singleton to WorkflowDetailPage.tsx. Added `useEffect` to call `clearWorkflowNotifications(id)` when viewing a workflow, preventing re-notifications for errors user has already seen. Removed unused `checkIntervalMs` property from WorkflowNotifications class. The `reset()` method remains available for future logout flow integration.

### 17. fix-chat-pin-to-bottom.md
- **Status**: COMPLETED (2026-01-19)
- **Effort**: M
- **Description**: Pin-to-bottom doesn't react to content size changes (images loading, markdown expanding). Three separate scroll event listeners could be consolidated. Need ResizeObserver or MutationObserver.
- **Files**: `apps/web/src/components/ChatInterface.tsx`
- **Resolution**: Added ResizeObserver to ChatInterface.tsx that observes the container element. When content expands (images loading, markdown rendering) and user was at bottom, automatically scrolls to maintain bottom position. The three existing scroll listeners are kept separate as they serve distinct purposes: `ScrollToBottomDetector` marks chat as read, scroll position tracking detects user intent, and infinite scroll loads older messages.

### 18. restore-chat-scroll-position.md
- **Status**: NOT_STARTED
- **Effort**: M
- **Description**: Navigating away from chat and returning doesn't restore scroll position. Use sessionStorage, React Router state, or scroll restoration library. Must coordinate with pin-to-bottom logic.
- **Files**: `apps/web/src/components/ChatInterface.tsx`

---

## Priority P2 - Nice-to-Have (Cleanup, Polish)

### 19. cleanup-success-message-timeout.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: setTimeout in WorkflowEventGroup onSuccess callback not cleaned up on unmount. Use useEffect with proper cleanup.
- **Files**: `apps/web/src/components/WorkflowEventGroup.tsx`

### 20. workflow-status-badge-component.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: `getStatusBadge` function duplicated in 6+ files (MainPage, WorkflowDetailPage, TaskDetailPage, WorkflowsPage, TaskRunDetailPage, TasksPage). Extract to shared component.
- **Files**: Create `apps/web/src/components/StatusBadge.tsx`

### 21. deduplicate-task-event-group-header.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: TaskEventGroup renders header twice (~120 lines duplicated) - once in Link, once in div. Extract common header content.
- **Files**: `apps/web/src/components/TaskEventGroup.tsx`

### 22. hide-empty-event-dropdown.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: EventItem shows dropdown button even when no actions available. Shows disabled "No actions available" option.
- **Files**: `apps/web/src/components/EventItem.tsx`

### 23. extract-event-helper-functions.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: `transformGmailMethod()` and `formatDuration()` duplicated in TaskEventGroup and WorkflowEventGroup.
- **Files**: Create `apps/web/src/lib/event-helpers.ts`

### 24. extract-quick-reply-hook.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: ~40 lines of quick reply code duplicated in ChatPage and MainPage. Create `useQuickReply(chatId)` hook.
- **Files**: Create `apps/web/src/hooks/useQuickReply.ts`

### 25. remove-mainpage-quick-reply-dead-code.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: MainPage uses `useTaskByChatId("main")` but no task with chat_id="main" exists. Dead code includes useTaskByChatId, useTaskState, quickReplyOptions, handleQuickReply, QuickReplyButtons.
- **Files**: `apps/web/src/components/MainPage.tsx`

### 26. validate-ask-options.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: formatAsks accepts any string array without filtering empty strings or duplicates.
- **Files**: `packages/agent/src/ai-tools/ask.ts`

### 27. remove-duplicate-parse-asks.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: parseAsks and StructuredAsk duplicated in `apps/web/src/lib/parseAsks.ts` and `packages/agent/src/ai-tools/ask.ts`. Delete web copy, import from @app/agent.
- **Files**: Delete `apps/web/src/lib/parseAsks.ts`

### 28. consolidate-autonomy-mode-type.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: AutonomyMode type defined in 3 places: `packages/proto/src/schemas.ts` (source of truth), `packages/agent/src/agent-env.ts`, `apps/web/src/hooks/useAutonomyPreference.ts`.
- **Files**: Multiple - use `@app/proto` as single source

### 29. remove-autonomy-localstorage.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: useAutonomyPreference uses both localStorage and API for persistence - redundant. Rely solely on API/db cache.
- **Files**: `apps/web/src/hooks/useAutonomyPreference.ts`

### 30. remove-unused-autonomy-metadata.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: `autonomy` field in message metadata schema never read or written anywhere.
- **Files**: `packages/proto/src/schemas.ts`

### 31. remove-orphaned-agent-status.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Agent status infrastructure orphaned - setAgentStatus/getAgentStatus in api.ts, useAgentStatus hook (polling every 5s for nothing), status display in SharedHeader exist but startStatusUpdater removed. Also `packages/agent/src/interfaces.ts` only has unused Memory interface.
- **Files**: Multiple files - remove dead code

### 32. revert-context-building.md
- **Status**: NEEDS_VERIFICATION
- **Effort**: S
- **Description**: Commit fde4661 may introduce duplicate message loading. buildContext loads from memoryStore and chatStore. Has dedup logic, may not actually be broken - needs verification.
- **Files**: `packages/agent/src/agent-env.ts`

### 33. reuse-markdown-for-mermaid.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: MermaidDiagram component exists separately. Markdown component already has mermaid support. Remove duplicate, improve security, reduce bundle size.
- **Files**: `apps/web/src/components/MermaidDiagram.tsx`

### 34. restore-peer-error-logging.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Critical errors in Peer.ts use `this.debug()` instead of `console.error` - invisible in production since debug is disabled by default.
- **Files**: `packages/sync/src/Peer.ts`

### 35. service-worker-use-debug-module.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: service-worker.ts uses custom `DEBUG_SW = false` pattern instead of standard debug module.
- **Files**: `apps/web/src/service-worker.ts`

### 36. shared-worker-enable-debug.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: shared-worker uses debug() but has no `debug.enable()` call like worker.ts does.
- **Files**: `apps/web/src/shared-worker.ts`

### 37. standardize-dev-mode-check.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Main uses `import.meta.env.DEV`, worker uses custom `__DEV__` define constant. Standardize on `import.meta.env.DEV`.
- **Files**: `apps/web/src/worker.ts`, `apps/web/vite.config.ts`

### 38. explicit-debug-dependency.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: `debug` not in apps/web/package.json - works only as transitive dependency. Add explicit dependency.
- **Files**: `apps/web/package.json`

### 39. standardize-cost-display-format.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Cost display inconsistent: some use `.toFixed(4)` with `$` prefix, others use `.toFixed(2)` without. Standardize to `.toFixed(2)` without `$`.
- **Files**: `apps/web/src/components/WorkflowDetailPage.tsx`, `apps/web/src/components/ScriptRunDetailPage.tsx`

### 40. consistent-sync-trigger-pattern.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: `/api/connect` uses `await peer.checkLocalChanges()` while other mutation endpoints use `triggerLocalSync()`.
- **Files**: `apps/server/src/server.ts`

### 41. log-workflow-notification-fetch-errors.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Empty catch block in WorkflowNotifications silently ignores errors. Add console.debug logging.
- **Files**: `apps/web/src/lib/WorkflowNotifications.ts`

### 42. centralize-tray-badge-updates.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Both WorkflowNotifications and MainPage update tray badge redundantly.
- **Files**: `apps/web/src/lib/WorkflowNotifications.ts`, `apps/web/src/components/MainPage.tsx`

### 43. fix-connection-string-regex-test.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Test regex overly permissive. Nonce should be required (not optional), exp parameter unused.
- **Files**: `packages/tests/src/nostr-transport.test.ts`

### 44. use-file-ui-part-type-guard.md
- **Status**: NOT_STARTED
- **Effort**: S
- **Description**: Uses `(p as any).filename` instead of proper `isFileUIPart()` type guard. Better type safety and IDE autocomplete.
- **Files**: `packages/agent/src/agent-env.ts`

---

## Priority P3 - Post-V1 (Future Enhancements)

### 45. debug-mode-settings-toggle.md
- **Status**: NOT_STARTED
- **Effort**: M
- **Description**: Add debug mode toggle in settings screen for production debugging. Enable verbose debug output when activated. Persist in localStorage.
- **Files**: `apps/web/src/components/SettingsPage.tsx`

### 46. app-update-notification.md
- **Status**: NOT_STARTED
- **Effort**: M
- **Description**: No UI notification when service worker updates and new version activates. Add subtle toast or banner notification.
- **Files**: `apps/web/src/service-worker.ts`, `apps/web/src/App.tsx`

### 47. retry-reverse-navigation.md
- **Status**: NOT_STARTED
- **Effort**: M
- **Description**: Can navigate from retry run to original run, but not vice versa. Add "View retry" link on runs that have been retried.
- **Files**: `apps/web/src/components/ScriptRunDetailPage.tsx`, `packages/db/src/script-store.ts`

---

## FIXMEs Found in Code

These are documented FIXMEs in the codebase that need attention:

1. **packages/sync/src/Peer.ts:788** - Transaction delivery batching not implemented
2. **packages/sync/src/TransportClientHttp.ts:176** - EventSource not implemented for Node.js environments
3. **packages/sync/src/nostr/stream/StreamWriter.ts:515** - Rate limiting threshold uses magic number that needs configuration

---

## Additional Issues Found

### Gmail Tool Limited Implementation
- **File**: `packages/agent/src/tools/gmail.ts`
- **Issue**: Many Gmail methods throw "not implemented" for unlisted methods. Limited functionality may surprise users.

### Skipped Test Suites
- 5 test suites are skipped (require browser/network environment)
- Tests may not run in CI without proper environment setup

### TypeScript Suppressions
- 8 `@ts-ignore` suppressions found in codebase
- Each should be reviewed for proper type fixes

---

## V1 Feature Ideas (from ideas/)

### Implemented
- **simplify-question-answering.md**: QuickReplyButtons component implemented for answering agent questions
- **script-versioning.md**: Full UI implemented with diff view and rollback capability

### High Priority for V1 UX (NOT_STARTED)
- **dry-run-testing.md**: Safely test automation scripts before enabling scheduled runs
- **highlight-significant-events.md**: Color-code errors, fixes, user interactions, state changes
- **collapse-low-signal-events.md**: Auto-collapse routine read operations, keep high-signal events visible

### Future Enhancements (Post-V1)
- **user-balance-and-payments.md**: Credit system, Stripe integration, low-balance notifications
- **in-app-bug-report.md**: Contact support button with pre-filled error context
- **agent-status-from-active-runs.md**: Derive agent status from actually running tasks
- Draft management ideas: detect, prompt, archive abandoned drafts

---

## Summary Statistics

| Priority | Count | Status |
|----------|-------|--------|
| P0 (Critical) | 5 | 5 COMPLETED |
| P1 (Important) | 13 | 12 COMPLETED, 1 NOT_STARTED |
| P2 (Nice-to-have) | 26 | 1 NEEDS_VERIFICATION, 25 NOT_STARTED |
| P3 (Post-V1) | 3 | 3 NOT_STARTED |
| **Total** | **47** | **17 COMPLETED, 1 NEEDS_VERIFICATION, 29 NOT_STARTED** |

### V1 Feature Ideas

| Status | Count |
|--------|-------|
| IMPLEMENTED | 2 |
| NOT_STARTED (High Priority) | 3 |
| NOT_STARTED (Post-V1) | 4+ |
