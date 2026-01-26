# Spec: Optimize has_script Subquery

## Problem
The `getAbandonedDrafts()` query uses a correlated COUNT subquery to check if a workflow has scripts:

```sql
(SELECT COUNT(*) FROM scripts WHERE workflow_id = w.id) > 0 as has_script
```

This runs the COUNT for every workflow row, which is inefficient. COUNT scans all matching rows even though we only need to know if at least one exists.

## Solution
Use EXISTS instead of COUNT for better performance:

```sql
EXISTS(SELECT 1 FROM scripts WHERE workflow_id = w.id) as has_script
```

Or use a CASE expression:
```sql
CASE WHEN EXISTS(SELECT 1 FROM scripts WHERE workflow_id = w.id) THEN 1 ELSE 0 END as has_script
```

EXISTS stops at the first match, while COUNT must scan all matching rows.

## Expected Outcome
- Faster query execution for draft detection
- Reduced database load, especially with many scripts per workflow

## Considerations
- File: `packages/db/src/script-store.ts`
- Method: `getAbandonedDrafts()` (~line 863)
- Also check `getDraftActivitySummary()` for similar patterns
