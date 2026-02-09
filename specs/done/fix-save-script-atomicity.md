# Fix: Non-Atomic Script Save and active_script_id Update

## Source
- Review: `reviews/ca7df3b.txt`
- Commit: `ca7df3b`
- Severity: CRITICAL

## Problem

In `packages/agent/src/ai-tools/save.ts`, the script creation and `active_script_id` update are two separate database operations without transaction protection:

```typescript
// Line 96: Operation 1
await opts.scriptStore.addScript(newScript);

// Lines 116-127: Operation 2
await opts.scriptStore.updateWorkflowFields(workflow.id, {
  active_script_id: newScript.id,
  ...
});
```

Between these two operations, the workflow scheduler could:
1. Read the workflow (sees status='active')
2. Use the OLD `active_script_id` (not yet updated)
3. Execute the OLD script instead of the newly saved one

This is especially problematic during maintenance fixes where the old buggy script could execute one more time.

## Verification

Research confirmed the issue still exists. Both `addScript` and `updateWorkflowFields` support an optional `tx?: DBInterface` parameter, and the transaction pattern is well-established in the codebase.

## Fix

Wrap script creation and workflow field updates in a single transaction:

```typescript
await opts.scriptStore.db.tx(async (tx) => {
  await opts.scriptStore.addScript(newScript, tx);

  const fieldsToUpdate: Record<string, any> = {
    active_script_id: newScript.id,
  };

  if (title && (!workflow.title || !workflow.title.trim())) {
    fieldsToUpdate.title = title;
  }

  await opts.scriptStore.updateWorkflowFields(workflow.id, fieldsToUpdate, tx);

  if (wasInMaintenance) {
    await opts.scriptStore.updateWorkflowFields(
      workflow.id,
      {
        maintenance: false,
        next_run_timestamp: new Date().toISOString(),
      },
      tx
    );
  }
});
```

## Files to Modify

1. `packages/agent/src/ai-tools/save.ts` - Wrap operations in transaction

## Testing

- Verify that addScript supports tx parameter (it does per ScriptStore interface)
- Verify that updateWorkflowFields supports tx parameter (it does)
- Existing tests should pass since behavior is the same, just atomic
