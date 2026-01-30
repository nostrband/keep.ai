# Spec: Fix incrementMaintenanceFixCount Atomicity

## Problem

In `script-store.ts`, `incrementMaintenanceFixCount` performs UPDATE and SELECT in separate queries:

```typescript
await db.exec(`UPDATE ... SET maintenance_fix_count = maintenance_fix_count + 1 ...`);
const result = await db.execO(`SELECT maintenance_fix_count ...`);
```

This is a TOCTOU pattern - the value could change between UPDATE and SELECT.

## Solution

Either:
1. Use `UPDATE ... RETURNING maintenance_fix_count` for atomic read-modify-write
2. Wrap both operations in an explicit transaction

Option 1 is preferred as it's simpler and more efficient.

## Expected Outcome

- Increment and read happen atomically
- No possibility of reading stale or modified value

## Considerations

- Verify SQLite/cr-sqlite supports RETURNING clause
- If RETURNING not available, use transaction approach
