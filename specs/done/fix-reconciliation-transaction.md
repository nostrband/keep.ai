# Fix: Race Condition in Workflow Resumption - Add Transaction

## Source
- Review: `reviews/114589d.txt`
- Commit: `114589d` (exec-18: Mutation Reconciliation Runtime)
- Severity: CRITICAL

## Problem

In `packages/agent/src/reconciliation/scheduler.ts`, the `resumeWorkflow()` method updates two database records without transaction protection:

```typescript
// Line 245-247: First update (NOT IN TRANSACTION)
await this.api.scriptStore.updateWorkflowFields(mutation.workflow_id, {
  status: "active",
});

// Line 255-257: Second update (NOT IN TRANSACTION)
await this.api.handlerRunStore.update(handlerRun.id, {
  status: "active",
});
```

If the process crashes between these two updates:
- Workflow is marked `active` in `scripts` table
- Handler run remains `paused:reconciliation` in `handler_runs` table
- System is in inconsistent state preventing proper recovery

## Verification

Research confirmed:
1. Both methods support `tx?: DBInterface` parameter
2. Pattern is well-established in codebase (e.g., `handler-state-machine.ts` lines 622-681)
3. Issue has NOT been fixed as of latest commit

## Fix

Wrap both updates in a single transaction:

```typescript
private async resumeWorkflow(mutation: Mutation): Promise<void> {
  const workflow = await this.api.scriptStore.getWorkflow(mutation.workflow_id);
  if (!workflow) {
    log(`Workflow ${mutation.workflow_id} not found, cannot resume`);
    return;
  }

  const handlerRun = await this.api.handlerRunStore.get(mutation.handler_run_id);

  // Wrap both updates in a transaction for atomicity
  await this.api.db.db.tx(async (tx) => {
    if (workflow.status === "paused") {
      await this.api.scriptStore.updateWorkflowFields(
        mutation.workflow_id,
        { status: "active" },
        tx
      );
      log(`Workflow ${mutation.workflow_id} resumed after reconciliation`);
    }

    if (handlerRun && handlerRun.status === "paused:reconciliation") {
      await this.api.handlerRunStore.update(
        handlerRun.id,
        { status: "active" },
        tx
      );
      log(`Handler run ${handlerRun.id} resumed after reconciliation`);
    }
  });
}
```

## Files to Modify

1. `packages/agent/src/reconciliation/scheduler.ts` - Update `resumeWorkflow()` method

## Testing

The existing test suite should continue to pass. Consider adding a test that verifies the transaction pattern is used (mock db.tx and verify it's called).

## Notes

- The fetch operations (`getWorkflow`, `get`) remain outside the transaction as they're read-only
- The `tx` parameter uses the existing `DBInterface` type from the codebase
- Access pattern: `this.api.db.db.tx()` matches other usages in the codebase
