# Spec: Archive Old Drafts

## Problem Statement

Over time, users accumulate draft workflows that were started but never completed or activated. These drafts clutter the main workflow list, making it harder to find active and relevant automations. Currently, there is no way to clean up old drafts without permanently deleting them (which would lose potentially useful work).

The goal is to provide a non-destructive way to hide very old drafts from the main view while preserving them for potential future use.

## What "Archive" Means

An archived draft is:
- **Hidden from main workflow list** - Does not appear on MainPage by default
- **Still accessible** - Can be viewed in a dedicated "Archived" section
- **Restorable** - Can be unarchived to return to the main list
- **Fully preserved** - All data (scripts, runs, chat history) remains intact
- **Not scheduled** - Archived workflows never run (same as current draft behavior)

Archive is distinct from delete:
- **Delete** = Permanent removal, data unrecoverable
- **Archive** = Hidden from view, data preserved, easily restorable

## Schema Changes

### Option A: New Status Value (Recommended)

Extend the existing `status` field to include an `"archived"` value:

| `workflow.status` | Badge    | Color | Visible in Main List | Scheduler Runs? |
|-------------------|----------|-------|----------------------|-----------------|
| `""`              | Draft    | Gray  | Yes                  | No              |
| `"active"`        | Running  | Green | Yes                  | Yes             |
| `"disabled"`      | Paused   | Yellow| Yes                  | No              |
| `"archived"`      | Archived | Gray  | No (separate view)   | No              |

**Pros:**
- Uses existing field, no schema migration needed
- Natural extension of current status model
- Scheduler already filters by status

**Cons:**
- Mixes lifecycle state (draft/active/paused) with visibility state (archived)
- Cannot archive an active workflow (would need to pause first)

### Option B: Separate `archived` Boolean Field

Add a new `archived: boolean` field to the workflows table:

```typescript
interface Workflow {
  // ... existing fields
  archived: boolean;  // New field, defaults to false
}
```

**Pros:**
- Cleaner separation of concerns
- Could theoretically archive a paused workflow while preserving its status
- Follows existing pattern (like `maintenance` boolean)

**Cons:**
- Requires database migration
- More complex query filtering (need to check both status AND archived)

### Recommendation

Use **Option A (new status value)** because:
1. No migration needed
2. Simpler implementation
3. For drafts specifically, archived status is semantically correct
4. If user wants to archive a running workflow, pausing it first makes sense

## Auto-Archive Criteria

Automatically archive drafts based on inactivity:

### Triggering Conditions
A draft workflow should be flagged for auto-archive when ALL of:
- `status = ""` (Draft)
- Last activity timestamp > 30 days ago (configurable)
- No script runs in the past 30 days
- No chat messages in the past 30 days

### "Last Activity" Definition
Last activity is the most recent of:
- `workflow.timestamp` (creation/update time)
- Latest script run `start_timestamp` for this workflow
- Latest chat event timestamp for the associated task

### Auto-Archive Behavior
Two approaches (can implement both):

1. **Prompt-based (Recommended for v1):**
   - Show banner: "You have 3 drafts with no activity for 30+ days. Archive them?"
   - User clicks to review and confirm archival
   - Preserves user control

2. **Silent auto-archive (Future enhancement):**
   - Automatically archive after 90 days of inactivity
   - Send notification when this happens
   - Add to user settings: "Auto-archive inactive drafts after X days"

## Manual Archive

Users can manually archive any draft:

### UI Entry Points
1. **Workflow Detail Page:**
   - "Archive" button in the action bar (for drafts only)
   - Confirmation: "Archive this draft? It will be hidden from your main list but can be restored anytime."

2. **Main Page Context Menu:**
   - Right-click or dropdown menu on workflow item
   - "Archive" option (for drafts only)

3. **Bulk Archive:**
   - Multi-select mode on main page
   - "Archive selected" action

## Viewing Archived Drafts

### Dedicated Archive View

Add an "Archived" section accessible from:
1. **Main Page link:** "View X archived drafts" at bottom of workflow list
2. **Settings/Preferences:** Archive management section

### Archive View UI

```
+---------------------------------------------+
| <- Back to automations                      |
|                                             |
| Archived Drafts (3)                         |
+---------------------------------------------+
| Weather alerts          Archived 30d ago    |
|   Created: Jan 1, 2026                      |
|   [Restore] [Delete permanently]            |
+---------------------------------------------+
| Email summarizer        Archived 15d ago    |
|   Created: Dec 15, 2025                     |
|   [Restore] [Delete permanently]            |
+---------------------------------------------+
```

### Archive View Features
- Shows archived timestamp (when it was archived)
- Shows original creation date
- Quick restore button
- Permanent delete option (with confirmation)
- Click to view workflow details (read-only or with restore prompt)

## Restoring Archived Drafts

### Restore Actions
1. **From Archive View:** "Restore" button on each item
2. **From Workflow Detail:** If navigating directly to archived workflow, show banner: "This draft is archived. [Restore it]"

### Restore Behavior
- Sets `status` back to `""` (Draft)
- Workflow reappears in main list
- All data preserved (scripts, runs, chat history)
- No additional user input needed

## Relationship to Detect/Prompt Features

This spec is part of the "Abandoned Draft Handling" feature set from IMPLEMENTATION_PLAN.md:

1. **Detect abandoned drafts** - Identify drafts meeting inactivity criteria
2. **Prompt user about stale drafts** - Show notification/banner about inactive drafts
3. **Archive old drafts** - This spec: move inactive drafts to archive

### Integration Flow

```
Detect -> Prompt -> User Decision -> Archive or Dismiss

Daily check:
  Find drafts with no activity for 30+ days
  If found:
    Show banner on main page: "3 drafts have been inactive for a while"
    User clicks banner -> sees list of stale drafts
    For each draft:
      [Archive] [Keep] [Delete]
```

### Prompt UI (from related spec)

```
+---------------------------------------------+
| (zzz) 3 drafts waiting for you              |
| These drafts have had no activity for       |
| 30+ days. What would you like to do?        |
|                                             |
| [ ] Weather alerts (created Jan 1)          |
| [ ] Email summarizer (created Dec 15)       |
| [ ] Task tracker (created Dec 10)           |
|                                             |
| [Archive Selected] [Keep All] [Dismiss]     |
+---------------------------------------------+
```

## Implementation Approach

### Phase 1: Manual Archive (MVP)

**Files to Modify:**

1. **`/apps/web/src/components/WorkflowDetailPage.tsx`**
   - Add "Archive" button for draft workflows
   - Add archived state detection and restore banner

2. **`/apps/web/src/components/MainPage.tsx`**
   - Filter out `status === "archived"` from main list
   - Add "View X archived" link at bottom

3. **`/packages/db/src/script-store.ts`**
   - Update `listWorkflows()` to optionally include/exclude archived
   - Add `listArchivedWorkflows()` method

4. **`/apps/web/src/hooks/dbScriptReads.ts`**
   - Add `useArchivedWorkflows()` hook

5. **`/apps/web/src/hooks/dbWrites.ts`**
   - Add `useArchiveWorkflow()` mutation
   - Add `useRestoreWorkflow()` mutation

6. **`/apps/web/src/components/ArchivedPage.tsx`** (new file)
   - Dedicated page for viewing archived drafts

7. **`/apps/web/src/App.tsx`**
   - Add route for `/archived` page

### Phase 2: Stale Draft Detection

**Files to Modify:**

1. **`/packages/db/src/script-store.ts`**
   - Add `getStaleWorkflows(inactiveDays: number)` method
   - Query joins workflow, script_runs, and chat_events to compute last activity

2. **`/apps/web/src/components/MainPage.tsx`**
   - Add stale drafts banner component
   - Show when stale drafts are detected

3. **`/apps/web/src/hooks/dbScriptReads.ts`**
   - Add `useStaleDrafts()` hook

### Phase 3: Auto-Archive (Optional)

**Files to Modify:**

1. **`/packages/db/src/config-store.ts`**
   - Add `auto_archive_days` setting (default: 0 = disabled)

2. **`/packages/agent/src/workflow-scheduler.ts`**
   - Add periodic check for auto-archivable drafts
   - Create notification when auto-archiving

3. **Settings UI**
   - Add toggle/input for auto-archive configuration

## Database Queries

### List Non-Archived Workflows
```sql
SELECT * FROM workflows
WHERE status != 'archived'
ORDER BY timestamp DESC
```

### List Archived Workflows
```sql
SELECT * FROM workflows
WHERE status = 'archived'
ORDER BY timestamp DESC
```

### Find Stale Drafts (30+ days inactive)
```sql
SELECT w.* FROM workflows w
LEFT JOIN (
  SELECT workflow_id, MAX(start_timestamp) as last_run
  FROM script_runs
  GROUP BY workflow_id
) sr ON w.id = sr.workflow_id
LEFT JOIN (
  SELECT chat_id, MAX(timestamp) as last_chat
  FROM chat_events
  JOIN tasks ON tasks.id = chat_events.task_id
  WHERE tasks.id = w.task_id
  GROUP BY chat_id
) ce ON w.task_id = ce.task_id
WHERE w.status = ''
  AND COALESCE(
    MAX(w.timestamp, sr.last_run, ce.last_chat),
    w.timestamp
  ) < datetime('now', '-30 days')
```

## Edge Cases

1. **Archive with unsaved changes:** If user has unsent message in chat, warn before archiving
2. **Archive linked to running task:** Only drafts can be archived; active workflows must be paused first
3. **Restore to busy state:** If task was in "wait" state when archived, restore to that state
4. **Sync between devices:** Archive status syncs via cr-sqlite like other workflow fields
5. **Search results:** Archived workflows excluded from search by default; add filter option

## Success Metrics

- Reduction in visible drafts on main page (cleaner UI)
- Archive feature usage (manual archives per user per month)
- Restore rate (low rate = users archiving correctly; high rate = too aggressive)
- Time spent on main page (should decrease with less clutter)

## Future Enhancements

1. **Bulk operations:** Select multiple drafts to archive/restore/delete
2. **Archive expiration:** Permanently delete archived drafts after 1 year
3. **Archive reasons:** Tag why something was archived (abandoned, superseded, testing)
4. **Search in archives:** Full-text search across archived workflows
5. **Archive active workflows:** Allow archiving paused workflows (preserve paused state)
