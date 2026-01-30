# Implementation Plan

This document tracks the implementation progress for the Keep.ai automation platform.

---

## Priority 1: Maintainer Task Type ✅ Complete

**Spec:** [specs/maintainer-task-type.md](specs/maintainer-task-type.md)

Introduces a new `maintainer` task type for bounded, autonomous script repair. The maintainer operates separately from the planner with restricted tools and limited scope.

**Completed:** All database layer, agent layer, UI layer, and testing items implemented. See spec for details.

---

## Priority 2: Tier 1 v1 Features (Critical)

### Dry-Run Testing

**Idea:** [ideas/dry-run-testing.md](ideas/dry-run-testing.md)

Add ability to test workflow scripts without side effects.

- [x] **Dry-run mode flag** - `executeWorkflow()` accepts `runType` parameter in workflow-worker.ts
- [x] **Test execution API** - `/api/workflow/test-run` endpoint in server.ts with background execution
- [x] **Result capture** - Results/logs saved to script_run record, viewable in run history
- [x] **UI trigger** - "Test Run" button in WorkflowDetailPage.tsx with success/failure feedback

### Collapse Low-Signal Events

**Idea:** [ideas/collapse-low-signal-events.md](ideas/collapse-low-signal-events.md)

Reduce visual noise in event timeline.

- [x] **Event significance classification** - `getEventSignalLevel()` in eventSignal.ts with LOW_SIGNAL_EVENTS array
- [x] **Collapsible event groups** - `EventListWithCollapse` component manages collapse/expand state
- [x] **Smart summarization** - `CollapsedEventSummary` component shows count, types, aggregate cost
- [x] **Auto-expand on error** - Events auto-expand when `hasError` is true for debugging context
- [ ] **User preference persistence** - Remember collapse preferences (future enhancement)

### Highlight Significant Events

**Idea:** [ideas/highlight-significant-events.md](ideas/highlight-significant-events.md)

Make important events stand out in the timeline.

- [x] **Significance scoring** - `EventSignificance` type with 6 levels: normal, write, error, success, user, state
- [x] **Visual differentiation** - `significanceStyles` in EventItem.tsx with color-coded borders/backgrounds
- [x] **Group error highlighting** - Red left border (`border-l-4 border-l-red-500`) for error groups
- [ ] **Filter by significance** - Option to show only significant events (future enhancement)
- [ ] **Notification integration** - Link significant events to notifications (future enhancement)

### Detect Abandoned Drafts

**Idea:** [ideas/detect-abandoned-drafts.md](ideas/detect-abandoned-drafts.md)

System to identify drafts with no activity.

- [x] **Inactivity threshold** - Define what constitutes "abandoned" (e.g., 7 days no activity) - DRAFT_THRESHOLDS constants in script-store.ts
- [x] **Last activity tracking** - Track last interaction timestamp per draft - Calculated via MAX() across chat_messages, scripts, and workflow.timestamp
- [x] **Detection query** - Query to find drafts exceeding inactivity threshold - getAbandonedDrafts() method in script-store.ts
- [x] **Abandoned status flag** - Mark drafts as potentially abandoned - AbandonedDraft interface with daysSinceActivity field
- [x] **getDraftActivitySummary()** - Summary method for UI banner showing totalDrafts, staleDrafts, abandonedDrafts, waitingForInput counts
- [x] **Unit tests** - Comprehensive tests in script-store.test.ts with boundary conditions

---

## Priority 3: Tier 2 v1 Features (Important)

### Prompt Stale Drafts

**Idea:** [ideas/prompt-stale-drafts.md](ideas/prompt-stale-drafts.md)

Notify users about stale drafts.

- [x] **Stale detection criteria** - DRAFT_THRESHOLDS constants (3 days stale, 7 days abandoned, 30 days archive)
- [x] **Notification generation** - StaleDraftsBanner component displays in MainPage
- [x] **Actionable notifications** - Banner links to `/workflows?filter=drafts`, shows waiting vs inactive counts
- [x] **Database integration** - useDraftActivitySummary hook queries getDraftActivitySummary() with 5-min auto-refresh

### Archive Old Drafts

**Idea:** [ideas/archive-old-drafts.md](ideas/archive-old-drafts.md)

Auto-archive drafts after extended inactivity.

- [x] **Archive action** - workflow.status="archived", archive button in WorkflowDetailPage, ArchivedPage view
- [x] **Unarchive capability** - Restore button restores to "paused" (with scripts) or "draft" (without scripts)
- [x] **Archived view** - /archived route with ArchivedPage component showing count, dates, restore actions
- [x] **Auto-archive threshold** - DRAFT_THRESHOLDS.ARCHIVE_DAYS (30 days) defined, archivableDrafts count in DraftActivitySummary, StaleDraftsBanner prompts user to archive drafts 30+ days inactive
- [x] **Archive notification** - StaleDraftsBanner on MainPage prompts user about archivable drafts, draft_archived notification type available for future silent auto-archive
- [ ] **Bulk archive** - Multi-select archive functionality - not implemented

### Script Versioning UI (Rollback)

**Idea:** [ideas/script-versioning.md](ideas/script-versioning.md)

Interface to view and rollback script versions.

**Note:** Depends on Maintainer Task Type version schema (major_version + minor_version).

- [x] **Version history view** - WorkflowDetailPage shows "View history (N versions)" with version list sorted by timestamp
- [x] **Version comparison** - ScriptDiff component with syntax highlighting, Myers diff algorithm (jsdiff library)
- [x] **Rollback action** - useActivateScriptVersion hook updates active_script_id with TOCTOU protection
- [x] **UI feedback** - "Activate" button per version, success message on activation, active version highlighted

### Agent Status from Active Runs

**Idea:** [ideas/agent-status-from-active-runs.md](ideas/agent-status-from-active-runs.md)

Derive agent status from active task_runs/script_runs instead of manual setAgentStatus calls.

- [x] **No manual status calls** - setAgentStatus does not exist; status derived from run counts
- [x] **Status derivation logic** - GET /api/agent/status derives isRunning from activeTaskRuns + activeScriptRuns counts
- [x] **Real-time status updates** - useAgentStatus hook with smart polling (5s when running, 30s when idle)
- [x] **Status query optimization** - countActiveTaskRuns() and countActiveScriptRuns() check end_timestamp = ''

---

## Priority 4: Tier 3 v1 Features (Nice-to-have)

### Script Diff View

**Idea:** [ideas/script-diff-view.md](ideas/script-diff-view.md)

Show differences between script versions.

- [x] **Diff algorithm** - ScriptDiff component uses jsdiff library with Myers algorithm
- [x] **Syntax highlighting** - Green for additions, red for deletions with line numbers
- [x] **Change summary** - Shows "+N lines", "-N lines" stats
- [ ] **Inline vs side-by-side** - Toggle between diff display modes (currently inline only)

### Simplify Question-Answering

**Idea:** [ideas/simplify-question-answering.md](ideas/simplify-question-answering.md)

Quick reply options for agent questions.

- [x] **Common response suggestions** - QuickReplyButtons component renders options from task.asks
- [x] **One-click responses** - handleQuickReply() submits option immediately as user message
- [x] **Double-click protection** - isQuickReplySubmitting state prevents duplicate submissions
- [x] **UI polish** - Long option truncation with tooltips, disabled state during submission

### Handle Abandoned Drafts

**Idea:** [ideas/handle-abandoned-drafts.md](ideas/handle-abandoned-drafts.md)

Actions for dealing with abandoned drafts.

**Note:** Depends on Detect Abandoned Drafts (Priority 2).

- [x] **User prompt flow** - StaleDraftsBanner prompts user about inactive drafts
- [x] **Recovery flow** - ArchivedPage with Restore button, smart status restoration
- [ ] **Bulk actions** - Handle multiple abandoned drafts at once (not implemented)
- [ ] **Auto-archive option** - Opt-in automatic archival (not implemented)

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

- [x] Tests for `connection-store.ts` - 25 tests covering CRUD, upsert, status/label/lastUsed updates, service filtering, metadata handling
- [x] Tests for `inbox-store.ts` - 23 tests covering CRUD, filtering, pagination, transaction support
- [x] Tests for `memory-store.ts` - 34 tests covering threads, messages, filtering, sorting, content parsing
- [x] Tests for `file-store.ts` - 46 tests covering CRUD, search, pagination, media type filtering, pattern matching

### packages/node

- [ ] Tests for `TransportServerFastify` - Complex SSE/HTTP transport layer, deferred to post-v1
- [x] Tests for `getDBPath` - 25 tests covering path construction, ensureEnv, key generation, users.json handling
- [x] Tests for `mimeUtils` - 36 tests covering buffer/filename detection, MIME type conversion, fallback handling
- [x] Tests for `fileUtils` - 41 tests covering path utilities, file system operations, storeFileData with hash calculation
- [x] Tests for `compression` - 35 tests covering gzip/none compression, streaming API, size limits, round-trip verification

### Skipped Tests (Environment Constraints)

8 skipped tests total, all with valid reasons:
- Browser-specific tests (WASM environment)
- P2P sync tests (requires real network)
- Network-dependent tests
- Compression error handling tests (zlib stream timing-sensitive, may not error synchronously for malformed data)

---

## Code Quality Notes

### Current Status
- **FIXMEs:** 2 (both in P2P sync code - optimization deferred)
- **Skipped tests:** 8 (environment constraints - P2P, browser, network, zlib timing)
- **Placeholder implementations:** None blocking v1
- **Overall:** Clean codebase, no critical issues

### Current Notification Types
The system supports 6 notification types:
- `error` - General errors
- `escalated` - User escalation needed
- `maintenance_failed` - Maintainer task could not fix the issue
- `script_message` - Script output messages
- `script_ask` - Script questions to user
- `draft_archived` - Draft workflow was archived due to inactivity

---

## Implementation Notes

### Maintainer Task Type Architecture

See [specs/maintainer-task-type.md](specs/maintainer-task-type.md) for complete implementation details including:
- Version migration strategy (major_version + minor_version)
- Race condition handling between planner and maintainer
- Thread isolation for maintainer tasks
- Context injection for maintainer system prompt
- Task scheduler priority (planner > worker > maintainer)
