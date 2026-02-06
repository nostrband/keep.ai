# exec-16: Inputs & Outputs UX

## Summary

Implement the user-facing Inputs & Outputs view for workflows, building on the data model from exec-15 (Input Ledger, causal tracking, ui_title). Users think in terms of "what came in" and "what happened," not internal workflow structure.

**Reference:** [`docs/dev/17-inputs-outputs.md`](../docs/dev/17-inputs-outputs.md)

---

## Prerequisites

- exec-15 complete: Input Ledger, caused_by tracking on events, ui_title on mutations

---

## Phases

### Phase 1: Query Infrastructure

**Goal:** Add database queries and API hooks for inputs/outputs UX.

**Tasks:**

1. **Add InputStore query methods:**
   - `getByWorkflowWithStatus(workflowId)` - returns inputs with computed pending/done/skipped status
   - Query joins events table to determine if any event with `caused_by` containing this input has status != 'consumed'

2. **Add MutationStore query methods:**
   - `getByInputId(inputId)` - returns mutations caused by an input (via events.caused_by → handler_run_id)

3. **Add EventStore query methods:**
   - `getByInputId(inputId)` - returns events that reference this input in caused_by

4. **Create React Query hooks:**
   - `useInputsByWorkflow(workflowId)` - inputs with status
   - `useMutationsByInput(inputId)` - mutations for an input
   - `useInputStats(workflowId)` - aggregated counts by source/type

**Files:**
- `packages/db/src/input-store.ts`
- `packages/db/src/mutation-store.ts`
- `packages/db/src/event-store.ts`
- `apps/web/src/hooks/dbInputReads.ts` (new)

---

### Phase 2: Dashboard Inputs Summary

**Goal:** Add inputs/outputs summary to WorkflowDetailPage.

**Display:**
```
Inputs
└─ Gmail Emails: 47 pending, 1,203 done

Outputs
├─ Sheets: 1,156 rows created
└─ Slack: 47 notifications sent

⚠ 2 inputs need your attention
```

**Tasks:**

1. Create `WorkflowInputsSummary` component showing:
   - Inputs grouped by source/type with pending/done counts
   - Outputs grouped by connector with counts
   - Action-needed indicator for blocked inputs

2. Add to WorkflowDetailPage below the existing metadata card

**Files:**
- `apps/web/src/components/WorkflowInputsSummary.tsx` (new)
- `apps/web/src/components/WorkflowDetailPage.tsx`

---

### Phase 3: Inputs List View

**Goal:** Detailed inputs view with status indicators.

**Display:**
```
┌─────────────────────────────────────────────────────────────┐
│ Gmail Emails                                      [Filter ▾]│
├─────────────────────────────────────────────────────────────┤
│ ● Email from alice@example.com: "Q4 Report"        pending  │
│ ● Email from bob@example.com: "Invoice #1234"      pending  │
│ ✓ Email from carol@example.com: "Meeting notes"    done     │
│ ✓ Email from dave@example.com: "Project update"    done     │
│ ⊘ Email from spam@example.com: "Buy now!"          skipped  │
└─────────────────────────────────────────────────────────────┘
```

**Tasks:**

1. Create `WorkflowInputsList` component:
   - List inputs with status indicators (●/✓/⊘)
   - Filter by status (pending/done/skipped/all)
   - Filter by time range
   - Search by title
   - Click to navigate to input detail

2. Status computation logic:
   - pending = any event with caused_by containing inputId has status='pending' or 'reserved'
   - done = all events with caused_by containing inputId have status='consumed'
   - skipped = input marked as skipped (future: Phase 5)

**Files:**
- `apps/web/src/components/WorkflowInputsList.tsx` (new)

---

### Phase 4: Input Detail View

**Goal:** Show what happened to a specific input.

**Display:**
```
Email from alice@example.com: "Q4 Report"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: Gmail / Email
Status: Done ✓
Received: Jan 15, 2025 at 2:34 PM

What happened:
  ✓ Row added to "Reports" sheet          Jan 15 at 2:35 PM
  ✓ Notification sent to #finance         Jan 15 at 2:35 PM
```

**Tasks:**

1. Create `InputDetailView` component:
   - Input metadata (source, type, title, received time)
   - Status badge
   - List of mutations caused by this input
   - Each mutation shows ui_title, status, timestamp

2. Create route `/workflow/:workflowId/input/:inputId`

3. Handle edge cases:
   - Zero outputs: "No external changes"
   - In-progress: Show "processing..." indicator
   - Failed mutations: Show error state

**Files:**
- `apps/web/src/components/InputDetailView.tsx` (new)
- `apps/web/src/App.tsx` (add route)

---

### Phase 5: Skip Input Functionality

**Goal:** Allow users to skip inputs they don't want processed.

**Tasks:**

1. Add `status` column to inputs table:
   - Values: 'active', 'skipped'
   - Add `skipped_at` timestamp column
   - Migration v45

2. Update InputStore:
   - `skip(inputId)` - mark input as skipped
   - Update `getByWorkflowWithStatus` to include skipped status

3. Implement skip semantics on events:
   - Pending events with caused_by containing skipped inputId → mark 'skipped'
   - Reserved events (pre-mutation) → abort run, release events
   - Reserved events (post-mutation) → let complete, mark 'consumed'

4. Add Skip button to Input Detail view
   - Confirmation dialog
   - Shows "Skipped (X outputs completed before skip)" if partial

**Files:**
- `packages/db/src/migrations/v45.ts` (new)
- `packages/db/src/input-store.ts`
- `apps/web/src/components/InputDetailView.tsx`

---

### Phase 6: Outputs View

**Goal:** Browse by output type (mutations).

**Display:**
```
┌─────────────────────────────────────────────────────────────┐
│ Outputs: Sheets rows                              [Filter ▾]│
├─────────────────────────────────────────────────────────────┤
│ ✓ Row added for alice@example.com      ← "Q4 Report"        │
│ ✓ Row added for bob@example.com        ← "Invoice #1234"    │
│ ⚠ Row added for dan@example.com        ← "Budget" (unconfirmed) │
└─────────────────────────────────────────────────────────────┘
```

**Tasks:**

1. Create `WorkflowOutputsList` component:
   - List mutations with ui_title
   - Link back to source input(s)
   - Status indicators (✓ applied, ⚠ indeterminate, ✗ failed)
   - Filter by status, connector, time range

2. Handle fan-in:
   - When mutation caused by multiple inputs (batch), show count
   - Expandable to show all contributing inputs

**Files:**
- `apps/web/src/components/WorkflowOutputsList.tsx` (new)

---

### Phase 7: Stale Input Warnings

**Goal:** Flag inputs pending longer than threshold.

**Tasks:**

1. Add query for stale inputs:
   - Pending status
   - created_at older than threshold (default: 7 days)

2. Show warnings in dashboard summary and inputs list
   - "pending 12 days" indicator
   - Highlight in yellow/orange

3. Configuration for stale threshold (future: per-workflow setting)

**Files:**
- `packages/db/src/input-store.ts`
- `apps/web/src/components/WorkflowInputsSummary.tsx`
- `apps/web/src/components/WorkflowInputsList.tsx`

---

### Phase 8: Tests

**Goal:** Comprehensive test coverage.

**Tests:**
1. InputStore query methods
2. Status computation (pending/done/skipped)
3. Skip semantics on events
4. Stale input detection
5. Component rendering tests

**Files:**
- `packages/tests/src/input-store.test.ts`
- `packages/tests/src/input-ux.test.ts` (new)

---

## Implementation Notes

### Status Computation Query

```sql
-- Input is 'pending' if any event references it and is not consumed
SELECT i.*,
  CASE
    WHEN i.status = 'skipped' THEN 'skipped'
    WHEN EXISTS (
      SELECT 1 FROM events e
      WHERE e.workflow_id = i.workflow_id
      AND json_array_contains(e.caused_by, i.id)
      AND e.status IN ('pending', 'reserved')
    ) THEN 'pending'
    ELSE 'done'
  END as computed_status
FROM inputs i
WHERE i.workflow_id = ?
```

### Causal Tracing Query

```sql
-- Get mutations caused by an input
SELECT m.*
FROM mutations m
JOIN handler_runs hr ON m.handler_run_id = hr.id
JOIN events e ON e.reserved_by_run_id = hr.id
WHERE json_array_contains(e.caused_by, ?)
  AND m.status IN ('applied', 'failed', 'indeterminate')
```

### UI Patterns

- Use existing card style: `bg-white rounded-lg border border-gray-200 p-6`
- Status badges: green (done/applied), yellow (pending), red (failed), gray (skipped)
- Status icons: ● pending, ✓ done, ⊘ skipped, ⚠ needs attention

---

## Success Criteria

1. Users can see inputs grouped by source/type with pending/done counts
2. Users can drill into input detail and see resulting mutations
3. Users can skip unwanted inputs
4. Stale inputs are visually flagged
5. All queries are efficient (no N+1 problems)
6. Tests cover all status computation scenarios
