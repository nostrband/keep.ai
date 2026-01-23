# Spec: Fix workflow title update in updateWorkflowFields

## Problem
Spec #19 (Agent Save Tool Title) is broken. The save tool at `packages/agent/src/ai-tools/save.ts` tries to update the workflow title via `updateWorkflowFields`, but the method doesn't support the title field:

1. The type signature at `packages/db/src/script-store.ts:757` doesn't include 'title' in the Pick type
2. The method body has no if-block to handle fields.title

Result: The title field is silently ignored and never persisted to the database, even though the code appears to update it.

## Solution
1. Add 'title' to the Pick type in updateWorkflowFields:
```typescript
fields: Partial<Pick<Workflow, 'timestamp' | 'next_run_timestamp' | 'status' |
        'cron' | 'maintenance' | 'maintenance_fix_count' | 'active_script_id' | 'title'>>
```

2. Add handling in the method body:
```typescript
if (fields.title !== undefined) {
  setClauses.push('title = ?');
  values.push(fields.title);
}
```

## Expected Outcome
- Workflow titles are actually persisted when agent save tool sets them
- Spec #19 works as intended
- Existing non-empty titles are still protected (logic is in save.ts)

## Considerations
- Add test to verify title is actually persisted to database
- Test that existing non-empty titles are NOT overwritten
