# Spec: Detect Abandoned Drafts

## Problem Statement

Users often start creating automation workflows but never complete them. These "abandoned drafts" are workflows with status="" (Draft) that have no recent activity. They clutter the workflow list and represent incomplete user intentions that may need follow-up.

Currently, there is no mechanism to:
1. Identify which drafts are abandoned vs. actively being worked on
2. Calculate when a draft was last interacted with
3. Query for drafts that exceed an inactivity threshold
4. Notify users about forgotten drafts or offer cleanup options

This spec defines how to detect abandoned drafts, laying the groundwork for future features like user prompts ("You have 3 drafts waiting - want to continue?") and auto-archiving.

## Definition of "Abandoned"

A draft is considered **abandoned** if:

1. **Status is Draft**: `workflow.status === ""`
2. **No activity for X days**: No chat messages, script saves, or workflow updates within the threshold period

### Suggested Thresholds

| Classification | Days Inactive | Use Case |
|---------------|---------------|----------|
| Stale | 3 days | Show subtle indicator in UI |
| Abandoned | 7 days | Prompt user in main screen |
| Archive candidate | 30 days | Offer to archive or delete |

The default threshold for "abandoned" should be **7 days**, configurable via a constant.

## Calculating Last Activity Time

Last activity for a workflow should be the **most recent** of:

1. **Chat event timestamp**: Most recent `chat_events.timestamp` where `chat_id` matches the workflow's associated chat
2. **Script save timestamp**: Most recent `scripts.timestamp` where `workflow_id` matches
3. **Workflow update timestamp**: `workflow.timestamp` (updated when cron/status changes)

### SQL Query for Last Activity

```sql
SELECT
  w.id,
  w.title,
  w.timestamp as workflow_updated,
  MAX(ce.timestamp) as last_chat_activity,
  MAX(s.timestamp) as last_script_activity,
  COALESCE(
    MAX(ce.timestamp),
    MAX(s.timestamp),
    w.timestamp
  ) as last_activity
FROM workflows w
LEFT JOIN tasks t ON t.id = w.task_id
LEFT JOIN chat_events ce ON ce.chat_id = t.chat_id
LEFT JOIN scripts s ON s.workflow_id = w.id
WHERE w.status = ''
GROUP BY w.id
```

### Timestamp Comparison

To find abandoned drafts (inactive for more than X days):

```sql
-- Get drafts with no activity for 7+ days
SELECT w.id, w.title, last_activity
FROM (
  SELECT
    w.id,
    w.title,
    COALESCE(
      MAX(ce.timestamp),
      MAX(s.timestamp),
      w.timestamp
    ) as last_activity
  FROM workflows w
  LEFT JOIN tasks t ON t.id = w.task_id
  LEFT JOIN chat_events ce ON ce.chat_id = t.chat_id
  LEFT JOIN scripts s ON s.workflow_id = w.id
  WHERE w.status = ''
  GROUP BY w.id
) w
WHERE datetime(last_activity) < datetime('now', '-7 days')
```

## Schema Changes

No schema changes required. The detection uses existing fields:
- `workflows.status` and `workflows.timestamp`
- `chat_events.timestamp` and `chat_events.chat_id`
- `scripts.timestamp` and `scripts.workflow_id`
- `tasks.chat_id` (to link workflow to chat)

### Optional Future Addition

If performance becomes an issue with many workflows, consider adding a computed/cached field:

```sql
-- Migration: Add last_activity_at to workflows (optional optimization)
ALTER TABLE workflows ADD COLUMN last_activity_at text not null default '';
```

This would be updated whenever:
- A chat event is added to the workflow's chat
- A script is saved for the workflow
- The workflow is modified

For v1, the join-based approach should be sufficient.

## API Method

### `getAbandonedDrafts()`

Add to `ScriptStore` class in `/packages/db/src/script-store.ts`:

```typescript
interface AbandonedDraft {
  workflow: Workflow;
  lastActivity: string;      // ISO timestamp
  daysSinceActivity: number; // Computed days
  hasScript: boolean;        // Whether any script exists
  isWaitingForInput: boolean; // task.state === 'wait' or 'asks'
}

async getAbandonedDrafts(
  thresholdDays: number = 7
): Promise<AbandonedDraft[]>
```

### Return Value

Returns an array of abandoned drafts sorted by `lastActivity` ascending (oldest first), including:
- The full workflow object
- Calculated last activity timestamp
- Days since last activity
- Whether a script exists (helps distinguish "in progress" from "forgotten")
- Whether waiting for user input (task asking a question)

### Usage Example

```typescript
// Get all drafts with no activity for 7+ days
const abandoned = await api.scriptStore.getAbandonedDrafts(7);

// Get stale drafts (3+ days)
const stale = await api.scriptStore.getAbandonedDrafts(3);

// Check if any drafts need attention
if (abandoned.length > 0) {
  // Show prompt: "You have X drafts waiting"
}
```

## API Method: `getDraftActivitySummary()`

For the main screen attention banner, add a summary method:

```typescript
interface DraftActivitySummary {
  totalDrafts: number;
  staleDrafts: number;      // 3-7 days inactive
  abandonedDrafts: number;  // 7+ days inactive
  waitingForInput: number;  // Drafts where agent asked a question
}

async getDraftActivitySummary(): Promise<DraftActivitySummary>
```

## Configuration Options

Add constants to a configuration location (suggest `/packages/agent/src/config.ts` or similar):

```typescript
export const DRAFT_THRESHOLDS = {
  STALE_DAYS: 3,           // Show subtle indicator
  ABANDONED_DAYS: 7,       // Prompt user
  ARCHIVE_DAYS: 30,        // Offer to archive
};
```

These could later be made user-configurable via settings.

## Implementation Notes

1. **Performance**: The join-based query should be efficient with existing indexes on `chat_events.chat_id`, `scripts.workflow_id`, and `workflows.status`. Monitor performance with large datasets.

2. **Time zone handling**: All timestamps are stored in ISO format (UTC). Calculate "days since" using UTC to avoid timezone issues.

3. **Edge cases**:
   - Workflow with no associated task (shouldn't happen, but handle gracefully)
   - Workflow created but no chat events yet (use workflow.timestamp)
   - Very old workflows from before this feature (include them)

4. **Exclusions**: Only check `status === ""` (Draft). Active and Paused workflows are intentional states.

## Future Features (Not in Scope)

This spec only covers detection. Future specs should address:

1. **User prompting** (`PROMPT_issues.md` item): Show "You have X drafts waiting - want to continue?" on main screen
2. **Auto-archiving**: Move very old drafts (30+ days) to an archive
3. **Notifications**: Remind users about forgotten drafts
4. **Bulk actions**: "Archive all abandoned drafts" button

## Testing

1. Create a draft workflow, verify it's not detected as abandoned
2. Simulate 8 days passing (mock Date.now), verify draft is now detected
3. Add a chat event, verify last_activity updates
4. Save a script, verify last_activity updates
5. Test with multiple drafts, verify sorting by oldest first
6. Test edge case: draft with no chat events or scripts

## Related Specs

- [Spec 00: Main Screen](../specs/00-main-screen.md) - Where abandoned draft indicators would appear
- [ideas/prompt-stale-drafts.md](./prompt-stale-drafts.md) - User prompting feature
- [ideas/archive-old-drafts.md](./archive-old-drafts.md) - Archive feature
