# Integration Topic 5: Mutation Lifecycle

> Depends on: Topic 1 (DB schema), Topic 2 (handler run status), Topic 3 (consumer phase)

## Summary

Replace direct `mutationStore.markApplied/markFailed/markIndeterminate/markNeedsReconcile`
calls with `ExecutionModelManager.applyMutation/failMutation/skipMutation/updateMutationStatus`.

This is the most complex topic because mutations are handled in two places:
1. **tool-wrapper.ts** — during live mutation execution (in sandbox)
2. **handler-state-machine.ts** — during state machine recovery (re-entering mutating phase)

## Current State

### tool-wrapper.ts — Live mutation handling

When a mutation tool is called in mutate phase:
1. Creates mutation record directly in `in_flight` status
2. Executes the tool
3. On success: calls `mutationStore.markApplied()`, sets `mutationApplied = true`, aborts script
4. On error: stores classified error on sandbox context, script aborts with error

The tool wrapper does NOT call `updateConsumerPhase(mutated)` — it only updates
the mutation record. The state machine (`executeMutate`) reads mutation status
on the next loop iteration and transitions the phase.

### handler-state-machine.ts — `executeMutate()` (lines 1279-1435)

After sandbox execution:
- If `wasMutationApplied()`: transition to mutated (bare updatePhase)
- If error + mutation exists + definite failure: `markFailed()`
- If error + mutation exists + uncertain: `handleUncertainOutcome()`
- If error + no mutation: `failRun()` (error before mutation was created)
- If mutation applied but abort didn't fire: transition to mutated
- If no mutation created: transition to mutated (no mutation tool called)

### handler-state-machine.ts — `handleUncertainOutcome()` (lines 506-576)

Immediate reconciliation attempt:
- Check if reconcile method exists → if not, `markIndeterminate()`
- Try reconciliation → applied/failed/retry/indeterminate
- Returns outcome string

### handler-state-machine.ts — Mutating phase handler (lines 1107-1161)

Re-entry into mutating phase (from state machine loop):
- No mutation yet → call executeMutate()
- mutation.status = "in_flight" → handleUncertainOutcome → phase transitions
- mutation.status = "applied" → transition to mutated
- mutation.status = "needs_reconcile" → pauseRun
- mutation.status = "indeterminate" → pauseRunForIndeterminate
- mutation.status = "failed" → failRun

## Changes Required

### 1. tool-wrapper.ts — Replace `markApplied()` with EMM

The tool wrapper currently calls `mutationStore.markApplied()` directly.
Replace with `emm.applyMutation()` which atomically:
- Sets mutation.status = "applied"
- Sets handler_run.mutation_outcome = "success"
- Advances phase to "mutated"
- Clears workflow.error

```typescript
// BEFORE (in tool-wrapper.ts mutation handling):
await this.api.mutationStore.markApplied(mutation.id, JSON.stringify(result));
this.mutationApplied = true;

// AFTER:
await this.emm.applyMutation(mutation.id, { result: JSON.stringify(result) });
this.mutationApplied = true;
```

**Issue:** The tool wrapper needs access to `emm`. Add it to `ToolWrapperConfig`:
```typescript
export interface ToolWrapperConfig {
  // ... existing fields
  emm?: ExecutionModelManager;  // NEW
}
```

### 2. tool-wrapper.ts — Handle mutation failure

Currently the tool wrapper doesn't call `markFailed()` — it stores the error
and lets the state machine handle it. This should stay the same, because
the failure classification (definite vs uncertain) happens in the state machine.

However, for definite failures detected in the tool wrapper itself (e.g.
LogicError from connector), we could call `emm.failMutation()`. But the current
flow (error propagates up → state machine classifies → calls EMM) is cleaner
and matches the spec's "caller flow (active run)".

**Decision:** Keep tool wrapper error flow as-is. Only change the success path
(`markApplied` → `applyMutation`).

### 3. handler-state-machine.ts — `executeMutate()` changes

**After tool wrapper returns with mutation applied:**
```typescript
// BEFORE:
if (mutationWasApplied) {
  await api.handlerRunStore.updatePhase(run.id, "mutated");
}

// AFTER:
if (mutationWasApplied) {
  // applyMutation already set phase to mutated inside tool-wrapper
  // Nothing to do here — phase transition already happened
}
```

**After error with mutation + definite failure:**
```typescript
// BEFORE:
if (isDefiniteFailure(classifiedError)) {
  await api.mutationStore.markFailed(mutation.id, classifiedError.message);
}

// AFTER:
if (isDefiniteFailure(classifiedError)) {
  await context.emm.failMutation(mutation.id, {
    error: classifiedError.message,
  });
  // failMutation atomically: sets failed + mutation_outcome="failure" +
  // advances to mutated + releases events + clears pending_retry + clears workflow.error
}
```

**After error with mutation + uncertain outcome:**
```typescript
// BEFORE:
await handleUncertainOutcome(api, mutation, classifiedError.message);

// AFTER:
// handleUncertainOutcome needs updating to use EMM methods
await handleUncertainOutcome(context.emm, api, mutation, classifiedError.message);
```

### 4. Update `handleUncertainOutcome()` to use EMM

```typescript
// BEFORE:
await api.mutationStore.markApplied(mutation.id, result.result ? JSON.stringify(result.result) : "");
await api.mutationStore.markFailed(mutation.id, errorMessage);
await api.mutationStore.markNeedsReconcile(mutation.id, errorMessage);
await api.mutationStore.markIndeterminate(mutation.id, errorMessage);

// AFTER:
await emm.applyMutation(mutation.id, { result: result.result ? JSON.stringify(result.result) : "" });
await emm.failMutation(mutation.id, { error: errorMessage });
await emm.updateMutationStatus(mutation.id, "needs_reconcile", { error: errorMessage });
await emm.updateMutationStatus(mutation.id, "indeterminate", { error: errorMessage });
```

### 5. Mutating phase handler — Replace mutation status handling

```typescript
// BEFORE (mutation.status === "applied"):
await api.handlerRunStore.updatePhase(run.id, "mutated");

// AFTER:
// If mutation is applied but phase is still mutating, call updateConsumerPhase
await context.emm.updateConsumerPhase(run.id, "mutated");
```

```typescript
// BEFORE (mutation.status === "needs_reconcile"):
await pauseRun(api, run, "paused:reconciliation", "needs_reconcile");

// AFTER:
await context.emm.updateHandlerRunStatus(run.id, "paused:reconciliation", {
  error: "needs_reconcile",
});
```

```typescript
// BEFORE (mutation.status === "indeterminate"):
await pauseRunForIndeterminate(api, run, "indeterminate_mutation");

// AFTER:
await context.emm.updateHandlerRunStatus(run.id, "paused:reconciliation", {
  error: "indeterminate_mutation",
});
```

```typescript
// BEFORE (mutation.status === "failed"):
await failRun(api, run, new LogicError(...));

// AFTER:
await context.emm.updateHandlerRunStatus(run.id, "failed:logic", {
  error: mutation.error || "Mutation failed",
  errorType: "logic",
});
```

### 6. indeterminate-resolution.ts — Out of scope?

This file has helpers for UI-triggered resolution (user clicks "didn't happen",
"assert applied", "skip"). These should also use EMM methods, but the file
is relatively small and the changes are straightforward:

- "assert applied" → `emm.applyMutation(mutationId, { result: ... })`
- "didn't happen" → `emm.failMutation(mutationId, { resolvedBy: "user_assert_failed" })`
- "skip" → `emm.skipMutation(mutationId)`

These can be included in this topic or deferred. They're not on the hot
execution path, so the crash-safety improvement is lower priority.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/sandbox/tool-wrapper.ts` | Add emm to config; replace markApplied with applyMutation |
| `packages/agent/src/handler-state-machine.ts` | Replace mutation store calls with EMM calls; update handleUncertainOutcome |
| `packages/agent/src/indeterminate-resolution.ts` | Replace mutation store calls with EMM calls (if in scope) |

## Verification

- Mutation success path: applyMutation atomically sets status + mutation_outcome + phase
- Mutation failure path: failMutation atomically releases events + clears pending_retry
- Uncertain outcome: handleUncertainOutcome uses EMM for all terminal outcomes
- tool-wrapper success no longer requires separate phase transition in state machine
- `turbo run build` passes
- Walk through scenario 5 (mutation applied) and scenario 6 (mutation fails) from spec
