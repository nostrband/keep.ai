# Spec: Fix Invalid Nested Aggregation in Draft Activity Query

## Problem

In `script-store.ts`, the draft activity query uses nested aggregate functions which is invalid SQL:

```sql
MAX(
  COALESCE(MAX(cm.timestamp), w.timestamp),
  COALESCE(MAX(s.timestamp), w.timestamp),
  w.timestamp
)
```

You cannot nest aggregate functions like `MAX(COALESCE(MAX(...), ...))`. SQLite may accept this syntax but produce incorrect or undefined results. Tests may pass by coincidence rather than correctness.

The intent is to find the maximum timestamp across all activity sources:
- Chat messages (cm.timestamp)
- Scripts (s.timestamp)
- Workflow creation (w.timestamp)

## Solution

Replace the nested aggregation with valid SQL. Recommended approach using CASE expression:

```sql
CASE
  WHEN MAX(cm.timestamp) IS NOT NULL
       AND MAX(cm.timestamp) > COALESCE(MAX(s.timestamp), w.timestamp)
    THEN MAX(cm.timestamp)
  WHEN MAX(s.timestamp) IS NOT NULL
       AND MAX(s.timestamp) > w.timestamp
    THEN MAX(s.timestamp)
  ELSE w.timestamp
END as last_activity
```

Alternative approaches:
- Subquery with UNION ALL and outer MAX
- GREATEST() function (requires SQLite 3.35+)

## Expected Outcome

- Valid SQL syntax that correctly finds the maximum timestamp
- Draft activity accurately reflects the most recent activity from any source
- Existing tests continue to pass (and now validate correct behavior)

## Considerations

- The same pattern may exist in both `getAbandonedDrafts` and similar queries - check all occurrences
- Verify SQLite version compatibility if using GREATEST()
- Add tests that specifically validate the MAX behavior across different timestamp combinations
