# Integration Topic 4: Commit Operations

> Depends on: Topic 1 (DB schema), Topic 2 (handler run status), Topic 3 (consumer phase)

## Summary

Replace `commitConsumer()` and `commitProducer()` in `handler-state-machine.ts`
with `ExecutionModelManager.commitConsumer()` and `ExecutionModelManager.commitProducer()`.

## Current State

### `commitConsumer()` in handler-state-machine.ts (lines 733-769)

Transaction:
1. Consume reserved events
2. Update handler state
3. Mark run committed (phase + status + output_state + end_timestamp)
4. Increment session handler count

Missing from current code:
- No `updateHandlerRunStatus` call (status set directly)
- No end_timestamp via EMM path

### `commitProducer()` in handler-state-machine.ts (lines 673-727)

Transaction:
1. Update handler state
2. Mark run committed (phase + status + output_state + end_timestamp)
3. Increment session handler count
4. Update producer schedule (next_run_at)

Missing from current code:
- Same as consumer

### Callers

**commitConsumer:**
- `prepared` handler — empty reservations (line 1095): `commitConsumer(api, run, undefined)`
- `emitting` handler — no next handler (line 1199): `commitConsumer(api, run, undefined)`
- `emitting` handler — after next() succeeds (line 1255): `commitConsumer(api, run, result.result)`

**commitProducer:**
- `executing` handler — after producer succeeds (line 954): `commitProducer(api, run, result.result)`

### schedulerState callback

After consumer commit, callers do:
```typescript
context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, hadReservations);
```
This updates in-memory dirty flags. The `hadReservations` parameter tells the
scheduler whether to clear the dirty flag (no reservations = consumer had no work,
clear dirty; had reservations = more work may exist, keep dirty).

## Changes Required

### 1. Replace `commitConsumer()` calls

```typescript
// BEFORE:
await commitConsumer(api, run, result.result);
context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, true);

// AFTER:
await context.emm.commitConsumer(run.id, {
  state: result.result,
  outputState: JSON.stringify(result.result),
});
context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name, true);
```

For the `undefined` state case:
```typescript
// BEFORE:
await commitConsumer(api, run, undefined);

// AFTER:
await context.emm.commitConsumer(run.id);
// OR with explicit undefined:
await context.emm.commitConsumer(run.id, { state: undefined });
```

### 2. Replace `commitProducer()` calls

```typescript
// BEFORE:
await commitProducer(api, run, result.result);

// AFTER:
// Need to get the schedule config to compute next_run_at
const schedule = await api.producerScheduleStore.get(run.workflow_id, run.handler_name);
let nextRunAt: number | undefined;
if (schedule) {
  nextRunAt = computeNextRunTime(schedule.schedule_type, schedule.schedule_value);
}

await context.emm.commitProducer(run.id, {
  state: result.result,
  outputState: JSON.stringify(result.result),
  nextRunAt,
});
```

**Issue:** The current `commitProducer()` reads the schedule inside the transaction.
EMM's `commitProducer()` takes `nextRunAt` as an input parameter. The schedule
read must happen before the EMM call.

**Alternative:** EMM could read the schedule internally. But the spec says
`opts.nextRunAt` is provided by the caller. Keeping the schedule read external
is cleaner — EMM doesn't need to know about schedule config parsing.

### 3. Remove old `commitConsumer()` and `commitProducer()` functions

After replacement, the standalone functions (lines 673-769) are dead code.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/handler-state-machine.ts` | Replace commit calls with EMM calls; remove old commit functions |

## Verification

- Consumer commit atomically: consumes events + saves state + sets status/phase + increments count
- Producer commit atomically: saves state + sets status/phase + updates schedule + increments count
- `commitConsumer` on a producer run throws (EMM guard)
- `commitProducer` on a consumer run throws (EMM guard)
- schedulerState callbacks still fire after commit
- `turbo run build` passes
