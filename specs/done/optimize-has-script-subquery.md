# Spec: Optimize has_script subquery in script-store.ts

## Problem
In `packages/db/src/script-store.ts:863`, the subquery `(SELECT COUNT(*) FROM scripts WHERE workflow_id = w.id) > 0 as has_script` executes once per returned row (N+1 query pattern). This could cause performance issues with large result sets.

## Solution
Replace the correlated subquery with a COUNT using the existing LEFT JOIN on the scripts table:
```sql
CASE WHEN COUNT(DISTINCT s.id) > 0 THEN 1 ELSE 0 END as has_script
```

## Expected Outcome
- Single query execution instead of N+1
- Better performance for queries returning many workflows
- Same functional behavior

## Considerations
- Verify the LEFT JOIN on scripts is already present in the query
- Ensure GROUP BY clause is appropriate for the aggregation
- Test with larger datasets to confirm performance improvement
