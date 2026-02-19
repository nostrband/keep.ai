# EMM / EMC Split — Browser-Safe Execution Model Client

## Motivation

The ExecutionModelManager (EMM) lives in `@app/agent` — a backend-only package.
The browser (`apps/web`) cannot import from `@app/agent` without pulling in AI
dependencies, OpenRouter config, tool definitions, etc.

Currently, the web app reimplements EMM logic inline (e.g. `useResolveMutation`
in `dbWrites.ts`) or bypasses EMM entirely for workflow operations (e.g.
`useUpdateWorkflow` calling `scriptStore.updateWorkflowFields` directly).
This is fragile: logic drifts, invariants are duplicated, and there's no
guardrail preventing someone from calling dangerous EMM methods (like
`createRetryRun` or `updateHandlerRunStatus`) from the browser.

### Key architectural constraint: concurrency

EMM runs on the backend, single-threaded. It doesn't need to worry about races.

The browser is:
- **Concurrent with the backend** — both can modify the same DB rows
- **Eventually consistent** — local DB syncs to backend with latency (cr-sqlite)
- **Not authoritative** — backend is the source of truth for execution state

This means EMC methods must be designed to be **safe under concurrent execution
with EMM**. Each method needs a clear concurrency analysis.

## Design

### EMM stays in `packages/agent/`

All backend execution methods remain in EMM. No changes.

### EMC goes in `packages/browser/src/execution-model-client.ts`

New file: `packages/browser/src/execution-model-client.ts`

EMC is a **restricted subset** of execution model operations, designed for
browser-side use. It:
- Takes `KeepDbApi` (same as EMM)
- Provides ONLY methods that are safe for concurrent browser execution
- Documents concurrency constraints for each method
- References EMM method it mirrors (for keeping logic in sync)

### Naming: `ExecutionModelClient`

"Client" emphasizes this is the consumer-facing side, not the authoritative
execution engine.

## Full EMM Method Review

### EMM methods → EMC classification

| # | EMM Method | Browser needs it? | EMC? | Rationale |
|---|---|---|---|---|
| 1 | `updateHandlerRunStatus` | No | **NO** | Active handler execution only. Complex side effects (event disposition, session finalization, maintenance flag). Backend-only. |
| 2 | `updateConsumerPhase` | No | **NO** | Phase transitions during active execution. Backend-only. |
| 3 | `commitConsumer` | No | **NO** | Terminal commit path during handler execution. Backend-only. |
| 4 | `commitProducer` | No | **NO** | Terminal commit for producers. Backend-only. |
| 5 | `applyMutation` | No | **NO** | User can't assert "applied" for indeterminate mutations — would require providing mutation result reference, loading and synthesizing it. Out of scope. |
| 6 | `failMutation` | Yes (user "didn't happen") | **YES** — as `resolveMutationFailed` | Indeterminate-guarded variant only. |
| 7 | `skipMutation` | Yes (user "skip") | **YES** — as `resolveMutationSkipped` | Indeterminate-guarded variant only. |
| 8 | `createRetryRun` | No | **NO** | Creates handler runs. Scheduler on backend only. |
| 9 | `finishSession` | No | **NO** | Session finalization. Backend-only. |
| 10 | `updateMutationStatus` | No | **NO** | Non-terminal mutation transitions during tool execution. Backend-only. |
| 11 | `pauseWorkflow` | Yes (user clicks pause) | **YES** | User-controlled status. Simple but should go through EMC for API boundary. |
| 12 | `resumeWorkflow` | Yes (user clicks resume) | **YES** | User-controlled status. Should also clear `workflow.error` (see §fix-04). |
| 13 | `exitMaintenanceMode` | Indirectly | **NO** | Browser uses `api.activateScript()` which clears maintenance atomically. No direct call needed. |
| 14 | `recoverCrashedRuns` | No | **NO** | Startup recovery. Backend-only. |
| 15 | `recoverUnfinishedSessions` | No | **NO** | Startup recovery. Backend-only. |
| 16 | `recoverMaintenanceMode` | No | **NO** | Startup recovery. Backend-only. |
| 17 | `assertNoOrphanedReservedEvents` | No | **NO** | Diagnostic. Backend-only. |

### Browser operations NOT currently in EMM

| Browser operation | Where called | EMC? | Rationale |
|---|---|---|---|
| Archive workflow (`status = "archived"`) | `useUpdateWorkflow` | **YES** — `archiveWorkflow` | Stops scheduling, user-controlled. |
| Unarchive/restore workflow | `useUpdateWorkflow` | **YES** — `unarchiveWorkflow` | Restores to paused/draft. |
| Activate script version | `useActivateScriptVersion` | **NO** | Already properly encapsulated in `api.activateScript()`. Clears maintenance, resets schedules atomically. Not an EMC concern. |
| Resume multiple workflows | `useResumeWorkflows` | **YES** — batch `resumeWorkflow` | After connection restored, resume all affected workflows. |

### `useUpdateWorkflow` is replaced entirely by EMC

Audit of all `useUpdateWorkflow` call sites shows it is ONLY used for status
changes — the `title`, `cron`, `next_run_timestamp` parameters are dead code
(never passed by any caller):

| Call site | Fields used |
|---|---|
| `WorkflowDetailPage:handlePause` | `status: "paused"` → `emc.pauseWorkflow()` |
| `WorkflowDetailPage:handleResume` | `status: "active"` → `emc.resumeWorkflow()` |
| `WorkflowDetailPage:confirmArchive` | `status: "archived"` → `emc.archiveWorkflow()` |
| `WorkflowDetailPage:handleRestore` | `status: paused/draft` → `emc.unarchiveWorkflow()` |
| `ArchivedPage:handleRestore` | `status: paused/draft` → `emc.unarchiveWorkflow()` |

**Already cleaned up:**
- `WorkflowEventGroup:handleRetry` used `next_run_timestamp` for a dangerous
  direct write — **removed**. The component is marked `@deprecated` (chat
  workflow events are no longer produced, component never renders in practice).
- `useUpdateWorkflow` dead params (`title`, `cron`, `next_run_timestamp`)
  **stripped** — hook now only accepts `status: string` (required).
- After EMC migration, `useUpdateWorkflow` can be deleted entirely.

## EMC Methods

### 1. `resolveMutationFailed(mutationId)`

**Mirrors:** `EMM.failMutation()` — indeterminate-guarded variant.

**What it does (atomically):**
- Guard: mutation.status must be "indeterminate" (throws otherwise)
- Sets mutation status = "failed", resolved_by = "user_assert_failed", resolved_at
- Sets handler_run.mutation_outcome = "failure", phase = "mutated"
- Releases reserved events (back to pending)
- Clears workflow.pending_retry_run_id
- Clears workflow.error

### 2. `resolveMutationSkipped(mutationId)`

**Mirrors:** `EMM.skipMutation()` — indeterminate-guarded variant.

**What it does (atomically):**
- Guard: mutation.status must be "indeterminate"
- Sets mutation status = "failed", resolved_by = "user_skip", resolved_at
- Sets handler_run.mutation_outcome = "skipped", phase = "mutated"
- Skips reserved events (marks as terminal)
- Sets workflow.pending_retry_run_id = handler_run_id (retry for next())
- Clears workflow.error

### 3. `pauseWorkflow(workflowId)`

**Mirrors:** `EMM.pauseWorkflow()` — identical behavior.

**What it does:**
- Sets workflow.status = "paused"

Simple single-field update. In EMC for API boundary — all user-initiated
execution state changes should go through EMC, not raw store calls.

### 5. `resumeWorkflow(workflowId)`

**Mirrors:** `EMM.resumeWorkflow()` — extended with error clearing.

**What it does:**
- Sets workflow.status = "active"
- Clears workflow.error (see rationale below)

**Why clear error on resume?** The current EMM spec says resume doesn't clear
error ("user must resolve the error first"). But in practice, the user clicking
"Resume" IS the signal that they've resolved the issue (reconnected auth,
decided to accept the state, etc.). If the underlying issue persists, the
scheduler will re-encounter it and set the error again on the next failed run.

This is fix-04's concern. If we decide NOT to clear error on resume, then
`resumeWorkflow` stays a trivial single-field update and arguably doesn't
need EMC. But if we DO clear error (likely), it becomes a multi-field
operation that benefits from encapsulation.

### 6. `archiveWorkflow(workflowId)`

**No direct EMM equivalent.** New EMC method.

**What it does:**
- Sets workflow.status = "archived"

Archive is a user-controlled status that completely stops all scheduling.
Similar to pause but more permanent.

### 7. `unarchiveWorkflow(workflowId)`

**No direct EMM equivalent.** New EMC method.

**What it does:**
- Sets workflow.status = "paused" (if workflow has active_script_id)
- Sets workflow.status = "draft" (if no active_script_id)

Unarchive restores to a safe non-running state. Never restores directly to
"active" — user must explicitly resume after unarchiving.

## Methods NOT in EMC (and why)

### Backend-only execution methods (NEVER expose to browser)

These methods operate on **active** execution state where the backend scheduler
and handler state machine are the sole owners. Browser must never call these:

- `updateHandlerRunStatus` — active run status transitions + event disposition +
  session finalization. Backend-only.
- `updateConsumerPhase` — phase transitions during active execution. Backend-only.
- `commitConsumer` / `commitProducer` — terminal commit paths. Backend-only.
- `createRetryRun` — creates handler runs, transfers reservations. Backend-only.
- `finishSession` — session finalization. Backend-only.
- `updateMutationStatus` — non-terminal mutation transitions during tool execution.
  Backend-only.
- All `recover*` methods — startup recovery. Backend-only.
- `assertNoOrphanedReservedEvents` — diagnostic. Backend-only.

### Operations that stay as direct store calls

- **Activate script version** — already encapsulated in `api.activateScript()`
  with atomic maintenance clearing and schedule sync. Not an EMC concern.

Note: `useUpdateWorkflow` previously accepted `title`/`cron`/`next_run_timestamp`
but those params were dead code (no callers). Already stripped — the hook now
only accepts `status` and will be deleted after EMC migration.

## Concurrency Analysis

### General model

```
Browser (EMC)                    Backend (EMM + Scheduler)
     |                                    |
     |--- write to local DB ------------->|
     |                                    |
     |    [sync latency window]           |
     |                                    |
     |<--- local DB syncs to backend ---->|
     |                                    |--- scheduler sees change
```

cr-sqlite sync is **row-atomic** (each row syncs as a unit). A transaction
touching multiple tables may arrive at the backend as separate row updates
over multiple sync ticks. This is the key concern.

### Methods 1-2: Mutation resolution — SAFE

**Both share the same precondition: mutation.status = "indeterminate"**

**Why indeterminate is a quiescent state:**
- Reconciliation scheduler has **given up** (exhausted attempts or no reconcile
  method). It will never touch this mutation again.
- Backend scheduler is **blocked** (workflow.error is set). No new sessions start.
- No handler runs are active for this workflow (run is paused:reconciliation,
  session is finalized).

**Concurrent EMM operations:** None. The workflow is in a stable "waiting for
user" state. No automated process reads or writes the affected rows.

#### resolveMutationFailed — partial sync analysis

Transaction touches: mutation row, handler_run row, events, workflow row.
If these sync as separate rows:
- mutation=failed syncs first → benign (no process acts on mutation status alone)
- handler_run.mutation_outcome=failure syncs → benign (run is still paused)
- events released sync → events become pending, but scheduler still blocked
  by workflow.error → events wait
- workflow.error="" syncs last → scheduler unblocked, starts fresh session

**Worst case:** error clears before events release → scheduler starts session,
prepare finds no unreserved events → empty session → retries next tick →
events have released by then. **No invariant violated.**

#### resolveMutationSkipped — partial sync analysis

Sets `pending_retry_run_id = run.id`. Scheduler must see BOTH pending_retry
AND error cleared to act.

- pending_retry syncs before error clears → scheduler blocked. **Safe.**
- error clears before pending_retry syncs → scheduler has no pending_retry,
  no pending events (skipped) → does nothing → next tick picks up. **Safe.**

#### Cross-method race: user double-clicks

All methods read-check mutation.status = "indeterminate". Second call sees
terminal status and throws. **Safe.**

#### Cross-module race: EMM and EMC on same mutation

**Cannot happen** for indeterminate mutations. Once indeterminate, no EMM
automated process touches it.

### Method 4: pauseWorkflow — SAFE

**What it does:** Sets workflow.status = "paused" (single field).

**Concurrent EMM operations:** EMM never writes workflow.status (it's
user-controlled per spec). The scheduler reads status but only at session
start — if status changes mid-session, the session completes normally.

**Sync latency:** Scheduler might start one session before pause syncs.
That session runs to completion (correct), then no more sessions start.
Not a correctness issue — just one extra session.

**Verdict: SAFE.** Last-write-wins on a user-controlled field with no
conflicting writers.

### Method 5: resumeWorkflow — SAFE

**What it does:** Sets workflow.status = "active", clears workflow.error.

**Concurrent EMM operations:**
- EMM never writes workflow.status (user-controlled).
- EMM does write workflow.error (system-controlled) — but only during active
  handler execution. If workflow.error is set, no handler is running (scheduler
  is blocked). So at the moment the user resumes, no EMM process is writing
  workflow.error.

**Edge case:** user resumes → clears error → scheduler starts session →
session encounters the same issue → EMM sets error again. This is correct
behavior — the error resurfaces naturally.

**Sync latency:** Status + error both on the same row (workflows table) →
they sync together as a unit. **No partial sync concern.**

**Verdict: SAFE.**

### Method 6: archiveWorkflow — SAFE

**What it does:** Sets workflow.status = "archived" (single field).

**Same analysis as pauseWorkflow.** EMM never writes status. Scheduler
stops considering this workflow. One in-flight session may complete.

**Verdict: SAFE.**

### Method 7: unarchiveWorkflow — SAFE

**What it does:** Sets workflow.status = "paused" or "draft" (single field).

**Same analysis.** Restores to non-running state, no concurrent conflicts.

**Verdict: SAFE.**

## Implementation Plan

### Step 1: Create EMC file

`packages/browser/src/execution-model-client.ts`

```typescript
import { KeepDbApi, Mutation } from "@app/db";

/**
 * ExecutionModelClient — browser-safe subset of execution model operations.
 *
 * CONCURRENCY: This module runs in the browser, concurrent with the backend
 * ExecutionModelManager (EMM). All methods are designed to operate on
 * quiescent state only — state that no automated backend process is
 * actively reading or writing. See specs/new/emm-emc-split.md for the
 * full concurrency analysis.
 *
 * SYNC: cr-sqlite syncs rows independently. Multi-table transactions may
 * arrive at the backend as separate row updates. All methods are designed
 * so that partial sync causes delays but never invariant violations.
 *
 * Mirrors: packages/agent/src/execution-model.ts (EMM)
 * If EMM logic changes, update EMC to match.
 */
export class ExecutionModelClient {
  constructor(private api: KeepDbApi) {}

  // --- Mutation resolution (mirrors EMM.failMutation/skipMutation/applyMutation) ---

  async resolveMutationFailed(mutationId: string): Promise<void> { ... }
  async resolveMutationSkipped(mutationId: string): Promise<void> { ... }

  // --- Workflow lifecycle (mirrors EMM.pauseWorkflow/resumeWorkflow) ---

  async pauseWorkflow(workflowId: string): Promise<void> { ... }
  async resumeWorkflow(workflowId: string): Promise<void> { ... }
  async archiveWorkflow(workflowId: string): Promise<void> { ... }
  async unarchiveWorkflow(workflowId: string): Promise<void> { ... }
}
```

### Step 2: Export from browser package

Add to `packages/browser/src/index.ts`.

### Step 3: Rework fix-02 (useResolveMutation)

Replace inline EMM logic with EMC calls:

```typescript
const emc = new ExecutionModelClient(api);
if (action === "did_not_happen") {
  await emc.resolveMutationFailed(mutation.id);
} else {
  await emc.resolveMutationSkipped(mutation.id);
}
```

### Step 4: Rework workflow hooks

Replace direct `scriptStore.updateWorkflowFields()` calls for status changes:

```typescript
// useUpdateWorkflow — status changes go through EMC
const emc = new ExecutionModelClient(api);
if (input.status === "paused") await emc.pauseWorkflow(input.workflowId);
else if (input.status === "active") await emc.resumeWorkflow(input.workflowId);
else if (input.status === "archived") await emc.archiveWorkflow(input.workflowId);
// Non-status fields (title, cron, next_run_timestamp) stay as direct store calls
```

```typescript
// useResumeWorkflows — batch resume via EMC
for (const w of workflows) {
  await emc.resumeWorkflow(w.workflowId);
  await api.notificationStore.resolveNotification(w.notificationId);
}
```

### Step 5: Update fix specs

- fix-02: superseded by EMC implementation
- fix-04: folded into EMC.resumeWorkflow (error clearing)

## Future considerations

### Queue-based approach

For operations where sync latency is a concern, we could use a queue pattern:
browser writes an action request row, backend processes it via EMM. This avoids
all sync issues by making the backend the sole writer of execution state.

**Not needed currently** — all EMC methods operate on quiescent state where
partial sync is safe. If future methods need to operate on non-quiescent state
(e.g. user canceling an in-progress handler), consider the queue approach.

### Keeping EMC in sync with EMM

EMC methods mirror specific EMM methods. If EMM logic changes, EMC must be
updated to match. Mitigate with:
- Cross-references in comments (EMC → EMM method it mirrors)
- The concurrency analysis above (documents which fields matter and why)
- Integration tests that verify EMC produces the same DB state as EMM
