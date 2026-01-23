# Spec: Wrap useActivateScriptVersion in transaction

## Problem
In `apps/web/src/hooks/dbWrites.ts`, the `useActivateScriptVersion` hook has a time-of-check-to-time-of-use (TOCTOU) vulnerability:
1. `getScript(scriptId)` - validates script exists
2. (gap where script could theoretically be deleted)
3. `updateWorkflowFields()` - updates pointer to potentially deleted script

While the practical risk is low (script deletion during rollback is rare), this should be fixed for correctness.

## Solution
Wrap both operations in a database transaction to ensure atomic execution:
```typescript
api.db.db.tx(async (tx) => {
  const script = await getScript(scriptId, tx);
  if (!script) throw new Error("Script not found");
  await updateWorkflowFields(workflowId, { active_script_id: scriptId }, tx);
});
```

## Expected Outcome
- Both operations see consistent database state
- No possibility of updating pointer to a deleted script
- Transaction rolls back if script is deleted mid-operation

## Considerations
- Verify getScript and updateWorkflowFields accept transaction parameter
- Error handling should surface to the UI appropriately
