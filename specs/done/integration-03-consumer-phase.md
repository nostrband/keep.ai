# Integration Topic 3: Consumer Phase Transitions

> Depends on: Topic 1 (DB schema), Topic 2 (handler run status)

## Summary

Replace direct `api.handlerRunStore.updatePhase()` calls and the `savePrepareAndReserve()`
function in `handler-state-machine.ts` with `ExecutionModelManager.updateConsumerPhase()`.

This ensures phase ordering is validated, reservation is atomic with phase change,
and wakeAt is persisted atomically.

## Current State

### Direct phase updates in `handler-state-machine.ts`

1. **`pending → preparing`** (consumer, line 979):
   ```typescript
   await api.handlerRunStore.updatePhase(run.id, "preparing");
   ```

2. **`pending → executing`** (producer, line 876):
   ```typescript
   await api.handlerRunStore.updatePhase(run.id, "executing");
   ```
   Note: Producer phases are NOT managed by `updateConsumerPhase` — they stay as-is.

3. **`preparing → prepared`** via `savePrepareAndReserve()` (lines 613-666):
   - Transaction: update phase + save prepare_result + reserve events + record wakeAt
   - Also updates in-memory schedulerState cache

4. **`prepared → mutating`** (line 1100):
   ```typescript
   await api.handlerRunStore.updatePhase(run.id, "mutating");
   ```

5. **`prepared → committed`** (line 1095) — when empty reservations:
   ```typescript
   await commitConsumer(api, run, undefined);
   ```
   Note: This currently skips directly to committed. Per spec, it should go
   `prepared → emitting → committed` (next() must always run). But this is a
   separate behavioral change — for now, maintain current behavior.

6. **`mutating → mutated`** (lines 1129, 1143-1144, 1304, 1361, 1394, 1398):
   ```typescript
   await api.handlerRunStore.updatePhase(run.id, "mutated");
   ```

7. **`mutated → emitting`** (line 1168):
   ```typescript
   await api.handlerRunStore.updatePhase(run.id, "emitting");
   ```

## Changes Required

### 1. Replace `pending → preparing`

```typescript
// BEFORE:
await api.handlerRunStore.updatePhase(run.id, "preparing");

// AFTER:
await context.emm.updateConsumerPhase(run.id, "preparing");
```

### 2. Keep `pending → executing` (producer) unchanged

Producer phases use a different path (`executing` is producer-only).
`updateConsumerPhase` is only for consumers. Producer phase updates stay as bare
`api.handlerRunStore.updatePhase()` calls for now — producers are simple
(pending → executing → committed) and don't have the crash-window problems.

### 3. Replace `savePrepareAndReserve()` with `updateConsumerPhase(prepared)`

```typescript
// BEFORE:
await savePrepareAndReserve(api, run, prepareResult, context);

// AFTER:
const now = Date.now();
let wakeAtMs = 0;
if (prepareResult.wakeAt) {
  try {
    const parsed = new Date(prepareResult.wakeAt).getTime();
    wakeAtMs = clampWakeAt(parsed, now);
  } catch { /* invalid wakeAt ignored */ }
}

await context.emm.updateConsumerPhase(run.id, "prepared", {
  reservations: prepareResult.reservations || [],
  prepareResult: JSON.stringify(prepareResult),
  wakeAt: wakeAtMs || undefined,
});

// Update in-memory wakeAt cache (still needed)
context.schedulerState?.setWakeAt(run.workflow_id, run.handler_name, wakeAtMs);
```

Note: `clampWakeAt()` stays as a local utility — the EMM doesn't know about
wakeAt clamping policy. Clamping is done by the caller before passing to EMM.

### 4. Replace `prepared → mutating`

```typescript
// BEFORE:
await api.handlerRunStore.updatePhase(run.id, "mutating");

// AFTER:
await context.emm.updateConsumerPhase(run.id, "mutating");
// EMM validates reservations are non-empty
```

### 5. Handle `prepared → committed` (empty reservations)

Currently the code calls `commitConsumer()` directly. The spec says
`prepared → emitting` then emitting runs `next()` then `commitConsumer()`.
But changing this behavior is out of scope for this integration — it's a
behavioral/correctness change that needs its own discussion.

For now: keep the existing `commitConsumer()` call. Topic 4 handles commit
operations.

### 6. Replace `mutating → mutated`

This transition happens in multiple places:

a. **After reconciliation confirms applied** (line 1129):
   ```typescript
   // BEFORE:
   await api.handlerRunStore.updatePhase(run.id, "mutated");
   // AFTER:
   await context.emm.updateConsumerPhase(run.id, "mutated");
   ```

b. **When mutation status is already "applied"** (line 1143-1144):
   ```typescript
   // Same replacement
   ```

c. **In `executeMutate()` — when tool wrapper applied mutation** (line 1361):
   This will be handled by Topic 5 (mutation lifecycle) —
   `applyMutation()` internally calls `updateConsumerPhase(mutated)`.

d. **In `executeMutate()` — no mutate handler** (line 1304):
   ```typescript
   // BEFORE:
   await api.handlerRunStore.updatePhase(run.id, "mutated");
   // AFTER:
   await context.emm.updateConsumerPhase(run.id, "mutated");
   ```

e. **In `executeMutate()` — mutation already applied edge case** (line 1394):
   Same replacement.

f. **In `executeMutate()` — no mutation tool called** (line 1398):
   Same replacement.

### 7. Replace `mutated → emitting`

```typescript
// BEFORE:
await api.handlerRunStore.updatePhase(run.id, "emitting");

// AFTER:
await context.emm.updateConsumerPhase(run.id, "emitting");
// EMM validates mutation_outcome != "failure"
```

### 8. Remove `savePrepareAndReserve()` function

After replacement, this function is dead code (lines 613-666).

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/handler-state-machine.ts` | Replace direct updatePhase calls with EMM calls; remove savePrepareAndReserve |

## Verification

- All consumer phase transitions go through EMM
- Phase ordering validation works (e.g. can't go backward)
- `prepared → mutating` guard validates non-empty reservations
- `mutated → emitting` guard validates mutation_outcome != "failure"
- wakeAt and event reservation are atomic with preparing → prepared
- `turbo run build` passes
