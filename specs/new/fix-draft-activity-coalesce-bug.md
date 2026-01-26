# Spec: Fix Draft Activity COALESCE SQL Bug

## Problem
The `getAbandonedDrafts()` and `getDraftActivitySummary()` methods in `script-store.ts` have a SQL logic bug. They use COALESCE to find the last activity timestamp:

```sql
COALESCE(
  MAX(cm.timestamp),
  MAX(s.timestamp),
  w.timestamp
) as last_activity
```

COALESCE returns the **first non-NULL value**, not the maximum across all values. This means:
- A draft with chat messages from 10 days ago and script saves from 2 days ago
- Will incorrectly show as "10 days inactive" (picks chat timestamp first)
- Instead of "2 days inactive" (actual most recent activity)

This causes drafts to be incorrectly classified as stale/abandoned when they have recent activity.

## Solution
Use MAX across all timestamp values instead of COALESCE picking the first non-null:

```sql
MAX(
  COALESCE(cm.timestamp, '1970-01-01'),
  COALESCE(s.timestamp, '1970-01-01'),
  w.timestamp
) as last_activity
```

Or use a CASE expression to find the true maximum.

## Expected Outcome
- Draft activity timestamps correctly reflect the most recent activity across all sources
- Drafts are only marked as stale/abandoned when ALL activity sources are old
- Users see accurate "days since activity" information

## Considerations
- File: `packages/db/src/script-store.ts`
- Two methods affected: `getAbandonedDrafts()` (~line 858) and `getDraftActivitySummary()` (~line 934)
- SQLite 3.44+ has GREATEST function, but may need fallback for older versions
- Test with drafts that have different activity patterns (chat-only, script-only, mixed)
