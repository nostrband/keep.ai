# Script Run Expanded UI

## Overview

Expand the script run detail page (`/scripts/:id/runs/:runId`) from a flat metadata view into a tabbed interface showing the session's inputs, outputs, and handler runs. Add a new handler run detail sub-page.

## Current State

**ScriptRunDetailPage** (`/scripts/:id/runs/:runId`) shows:
- Run ID, status badge, retry info
- Script ID (link), Task ID (link)
- Start/end timestamps, duration, cost
- Error (preformatted), result (preformatted), logs (preformatted)

No handler run UI exists. No hooks for querying handler runs from the web app.

## Data Available

**HandlerRunStore** already supports:
- `getBySession(scriptRunId)` — all handler runs in a script run, ordered by `start_timestamp` ASC
- `get(id)` — single handler run with all fields
- `getRetryChain(runId)` — full retry chain for a handler run
- `getRetriesOf(runId)` — direct retry children

**HandlerRun fields**: `id`, `script_run_id`, `workflow_id`, `handler_type` (producer/consumer), `handler_name`, `phase`, `status`, `retry_of`, `prepare_result`, `input_state`, `output_state`, `start_timestamp`, `end_timestamp`, `error`, `error_type`, `cost`, `logs`

**Existing query patterns**: Inputs are fetched via `useWorkflowInputs(workflowId)`, mutations via `useWorkflowMutations(workflowId)`. Both need filtering to the script run's scope (by matching `created_by_run_id` for inputs, `handler_run_id` for mutations).

## Changes

### 1. New Query Hooks

**File**: `apps/web/src/hooks/dbHandlerRunReads.ts` (new)

```ts
// Handler run hooks
useHandlerRunsBySession(scriptRunId: string)  // calls handlerRunStore.getBySession()
useHandlerRun(handlerRunId: string)           // calls handlerRunStore.get()
useHandlerRunRetryChain(handlerRunId: string) // calls handlerRunStore.getRetryChain()
```

**File**: `apps/web/src/hooks/queryKeys.ts` — add:

```ts
handlerRunsBySession: (scriptRunId: string) => [{ scope: "handlerRunsBySession", scriptRunId }]
handlerRun: (handlerRunId: string) => [{ scope: "handlerRun", handlerRunId }]
handlerRunRetryChain: (handlerRunId: string) => [{ scope: "handlerRunRetryChain", handlerRunId }]
```

Meta tables: `["handler_runs"]` for all three.

For inputs/mutations scoped to a session, we have two options:
- **Option A**: Reuse `useWorkflowInputs` / `useWorkflowMutations` and filter client-side by matching handler_run_ids from the session's handler runs.
- **Option B**: Add new store methods like `inputStore.getBySessionRunIds(runIds[])` and `mutationStore.getBySessionRunIds(runIds[])`.

Recommend **Option A** for now — the data is already fetched for the workflow page, and script runs typically have a small number of handler runs. This avoids new DB methods and keeps the scope small. If performance becomes an issue we can add dedicated queries later.

### 2. Script Run Detail Page — Tabbed Layout

**File**: `apps/web/src/components/ScriptRunDetailPage.tsx` — rewrite

Keep the existing header section (run ID, status, timestamps, script/task links, retry info, cost). Below it, add a tab bar with three tabs:

**Tab bar**: `Inputs | Outputs | Handler Runs`

Each tab shows a simple list, sorted by timestamp ascending.

#### Tab: Inputs

Shows inputs registered during this script run's handler runs.

Filter: `inputs.filter(i => sessionHandlerRunIds.has(i.created_by_run_id))`

Each row:
- Status icon (reuse `StatusIcon` pattern from `WorkflowInputsPage`)
- Input title
- Source/type in gray
- Timestamp
- Click → navigates to `/workflow/:workflowId/input/:inputId`

Reuse the row rendering pattern from `WorkflowInputsPage` — same status icons, same layout. Wrap in `<Link>`.

Empty state: "No inputs registered during this run"

#### Tab: Outputs

Shows mutations created during this script run's handler runs.

Filter: `mutations.filter(m => sessionHandlerRunIds.has(m.handler_run_id))`

Each row:
- `MutationStatusIcon` (from `MutationRow.tsx`)
- `getMutationTitle(mutation)`
- Connector/method in gray
- Timestamp
- `MutationStatusBadge`
- Click → navigates to `/workflow/:workflowId/outputs?mutation=:id` (or simply expands inline like existing outputs page)

Reuse `MutationStatusIcon`, `MutationStatusBadge`, `getMutationTitle` from `MutationRow.tsx`.

Empty state: "No outputs produced during this run"

#### Tab: Handler Runs

Shows all handler runs in this session.

Data: `useHandlerRunsBySession(scriptRunId)` — already ordered by `start_timestamp` ASC.

Each row:
- Phase/status indicator (small colored dot or badge):
  - committed → green
  - active → blue/pulse
  - paused:* → yellow
  - failed:* → red
  - crashed → red
- Handler name (e.g., `pollEmail`, `processEmail`)
- Handler type badge: `producer` or `consumer` (small outline badge)
- Phase (e.g., `committed`, `mutated`, `preparing`)
- Start timestamp
- Duration (if end_timestamp exists)
- Error indicator (red text, truncated to one line) if error present
- Click → navigates to `/scripts/:id/runs/:runId/handler/:handlerRunId`

Empty state: "No handler runs recorded"

**New component**: `HandlerRunStatusBadge` in `StatusBadge.tsx`:

```ts
HandlerRunStatusBadge({ status: RunStatus, phase: HandlerRunPhase })
```

Colors:
- `committed` → green (`bg-green-50 text-green-700 border-green-300`)
- `active` → blue (`bg-blue-50 text-blue-700 border-blue-300`)
- `paused:transient` → yellow
- `paused:approval` → amber
- `paused:reconciliation` → amber
- `failed:logic` → red
- `failed:internal` → red
- `crashed` → red

Label: Show `status` value. For committed, just show "committed". For paused/failed, show the full status like "paused:approval".

### 3. Handler Run Detail Page (new)

**Route**: `/scripts/:id/runs/:runId/handler/:handlerRunId`

**File**: `apps/web/src/components/HandlerRunDetailPage.tsx` (new)

**Layout**: Single scrollable page with sections. Uses `SharedHeader` with subtitle like "Handler Run pollEmail".

#### Header Card

White card at top:
- Handler name as title (e.g., `processEmail`)
- Handler type badge (producer/consumer)
- `HandlerRunStatusBadge` showing status
- Phase badge showing current phase

Grid of metadata (same pattern as ScriptRunDetailPage):
- **Handler Run ID**: full ID, monospace
- **Session**: link to parent script run (`/scripts/:id/runs/:runId`)
- **Handler Type**: producer / consumer
- **Phase**: current phase value
- **Status**: current status value
- **Started**: timestamp
- **Ended**: timestamp (if present)
- **Duration**: computed (if both timestamps present)
- **Cost**: in dollars (if > 0)

If `retry_of` is set:
- **Retry of**: link to previous handler run

#### Error Section (conditional)

Only shown if `error` is non-empty. Red-tinted card.

- Error type badge (auth/permission/network/logic/unknown)
- Error message in preformatted block (same styling as ScriptRunDetailPage error)

#### Result / Prepare Result Section (conditional)

If handler_type is `consumer` and `prepare_result` is non-empty:

**Prepare Result** card:
- Parse JSON, show pretty-printed
- Extract and highlight `ui.title` if present (shown as a prominent line above the JSON)
- Show reservations summary: "Reserved N events from topic X"

#### Mutation Section (conditional, consumer only)

Query: `mutationStore.getByHandlerRunId(handlerRunId)` — this is a 1:1 relationship.

If mutation exists, show:
- Mutation title (`getMutationTitle`)
- `MutationStatusBadge`
- Tool: `namespace.method`
- Params (pretty JSON, collapsible)
- Result (pretty JSON, collapsible) — reuse `MutationResultPanel` pattern
- Error (if failed)

If no mutation: "No mutation performed"

#### Inputs Section (conditional, producer only)

For producers, show inputs registered during this handler run.

Filter: `inputs.filter(i => i.created_by_run_id === handlerRunId)`

Same row format as the Inputs tab on the script run page. Each links to `/workflow/:workflowId/input/:inputId`.

#### Events Section (conditional)

Show events created by or reserved by this handler run:
- **Published events**: `events.filter(e => e.created_by_run_id === handlerRunId)` — show topic, messageId, status, payload summary
- **Reserved events**: `events.filter(e => e.reserved_by_run_id === handlerRunId)` — show topic, messageId, status

This uses `eventStore.getByCreatedByRunId()` and `eventStore.getReservedByRun()` — the latter already exists. We may need to add `getByCreatedByRunId()` or filter client-side from a broader query.

For now, show this as a collapsible "Internal Events" section (secondary, debug-oriented), similar to `InputDetailPage`'s internal events section.

#### Logs Section (conditional)

Only shown if `logs` is non-empty and not `"[]"`.

Parse JSON array of log entries. Display each entry:
- Timestamp (if present in entry)
- Level/type indicator
- Message text

Fallback: show raw logs in preformatted block (same as current ScriptRunDetailPage).

#### Retry Chain Section (conditional)

Only shown if there are retries (the run has `retry_of` or other runs point to it).

Use `useHandlerRunRetryChain(handlerRunId)`.

Show timeline of attempts:
- Each with: attempt number, status badge, timestamp, duration
- Current run highlighted
- Each links to its own handler run detail page

### 4. Routing

**File**: `apps/web/src/App.tsx` — add route:

```tsx
<Route path="/scripts/:id/runs/:runId/handler/:handlerRunId" element={<HandlerRunDetailPage />} />
```

### 5. Components to Reuse

| Component | From | Used In |
|-----------|------|---------|
| `SharedHeader` | `SharedHeader.tsx` | All new pages |
| `MutationStatusIcon` | `MutationRow.tsx` | Outputs tab, handler run mutation section |
| `MutationStatusBadge` | `MutationRow.tsx` | Outputs tab, handler run mutation section |
| `getMutationTitle` | `MutationRow.tsx` | Outputs tab, handler run mutation section |
| `MutationResultPanel` | `MutationRow.tsx` | Handler run mutation section |
| `ExpandChevron` | `MutationRow.tsx` | Collapsible sections |
| `ScriptRunStatusBadge` | `StatusBadge.tsx` | Script run header (existing) |
| `Badge` | `ui/badge.tsx` | Throughout |
| `Button` | `ui/button.tsx` | Tab bar |
| Input status icons | `WorkflowInputsPage.tsx` | Inputs tab — extract to shared component or inline |

### 6. New Components

| Component | File | Purpose |
|-----------|------|---------|
| `HandlerRunStatusBadge` | `StatusBadge.tsx` | Status badge for handler runs |
| `HandlerRunDetailPage` | `HandlerRunDetailPage.tsx` | New page |
| Tab switching logic | inline in `ScriptRunDetailPage` | Simple state-based tab switching (`useState<"inputs" | "outputs" | "handlers">`) |

### 7. Store/DB Changes

**Needed new store methods** (if not filtering client-side):
- `eventStore.getByCreatedByRunId(runId)` — events published by a handler run
- Or filter client-side from `eventStore.getByWorkflow()` results

**Needed new hooks**:
- `useHandlerRunsBySession`
- `useHandlerRun`
- `useHandlerRunRetryChain`
- `useMutationByHandlerRunId` (wraps `mutationStore.getByHandlerRunId`)
- `useEventsByHandlerRun` (events created/reserved by a handler run)

**Query key additions**: 5 new entries in `queryKeys.ts`.

### 8. Navigation Flow

```
/scripts/:id/runs/:runId                    (Script Run Detail - tabbed)
  ├── [Inputs tab] → click row →            /workflow/:wfId/input/:inputId
  ├── [Outputs tab] → click row →           (expand inline or link to output)
  └── [Handler Runs tab] → click row →      /scripts/:id/runs/:runId/handler/:hrId
        └── [Handler Run Detail]
              ├── Session link →             /scripts/:id/runs/:runId
              ├── Input links →              /workflow/:wfId/input/:inputId
              └── Retry chain links →        /scripts/:id/runs/:runId/handler/:otherHrId
```

### 9. Open Questions

1. **Output click behavior**: Should clicking an output row expand inline (like current WorkflowOutputsPage) or navigate to the workflow outputs page filtered? Recommend: expand inline with `MutationResultPanel`, consistent with existing pattern.

2. **Event queries for handler run detail**: Should we add `eventStore.getByCreatedByRunId()` or filter client-side? Adding the store method is cleaner but adds scope. Since this is a debug-oriented section, client-side filtering from the workflow's events may suffice.

3. **Tab URL state**: Should the active tab be in the URL (e.g., `?tab=inputs`)? Recommend yes — use `useSearchParams` so direct links to a specific tab work and browser back preserves tab state.

4. **Input status icons**: The `WorkflowInputsPage` has inline status icon rendering (not extracted to a shared component). Should we extract it? Recommend: extract a small `InputStatusIcon({ status })` component into a shared file (e.g., `InputRow.tsx` alongside `MutationRow.tsx`) to avoid duplication.
