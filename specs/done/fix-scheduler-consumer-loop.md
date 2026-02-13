# Fix Scheduler Consumer Loop Bugs

## Context

The scheduler has a tight infinite loop bug. A workflow ("Summarize and Message Newsletters") keeps triggering sessions that immediately find no work, complete, and re-trigger. Root cause: 77 pending events in topic `newsletter.summarized` that no consumer subscribes to (the `deliverSummary` consumer was removed in script v2.0).

Investigation revealed three related issues:

1. **Orphaned-topic loop**: `hasAnyPendingForWorkflow()` checks ALL topics, but session only processes subscribed topics — mismatch causes infinite re-triggering. *Already hotfixed* in `workflow-scheduler.ts` but needs a proper defense-in-depth approach.

2. **No dirty flag**: Per spec (Chapter 16), consumers should only run when `dirty=true` (new events since last run) or `wakeAt` is due. The `SchedulerStateManager` class exists in `scheduler-state.ts` with full dirty flag logic but is **completely disconnected** — never instantiated or used. Without it, consumers busy-loop both within sessions (up to 100 iterations creating handler runs) and across sessions (scheduler keeps re-triggering).

3. **Missing script validation**: Topics published to but never subscribed are not detected at save/fix time, allowing orphaned-event accumulation.

---

## Fix 1: Wire Up In-Memory Dirty Flag

**Problem**: Consumer commits → `dirty` should be `false` → consumer should not re-launch until new event arrives. Currently there is no dirty tracking, so any pending events (whether already examined or not) cause re-triggering.

**Design**: Wire up the existing `SchedulerStateManager` (in-memory dirty/queued flags). Per spec Chapter 16, these flags are:
- Cheap to update (no DB writes, no sync overhead)
- Recoverable on restart (set all consumers dirty, query pending events)
- The single mechanism for both within-session and cross-session scheduling

No schema changes needed.

### Extend `SchedulerStateManager` with `wakeAt` Tracking

Add `wakeAt` to `ConsumerSchedulerState`:

```typescript
interface ConsumerSchedulerState {
  dirty: boolean;
  wakeAt: number;  // 0 = no scheduled wake, >0 = unix ms
}
```

Add methods to `SchedulerStateManager`:
- `setWakeAt(workflowId, consumerName, wakeAtMs)` — called when prepare stores wakeAt
- `getConsumersWithDueWakeAt(workflowId)` — returns consumer names where `wakeAt > 0 && wakeAt <= Date.now()`

This eliminates the DB query `handlerStateStore.getConsumersWithDueWakeAt()` from both the scheduler hot path and the session loop. The DB remains the source of truth (for restart recovery), but the scheduler reads from memory.

On restart: read `wake_at` from `handler_state` table and populate the cache.

### Integration Points

#### 1. Add `schedulerState` to `HandlerExecutionContext`

**`packages/agent/src/handler-state-machine.ts`**:

```typescript
export interface HandlerExecutionContext {
  api: KeepDbApi;
  connectionManager?: ConnectionManager;
  userPath?: string;
  abortController?: AbortController;
  schedulerState?: SchedulerStateManager;  // NEW
}
```

#### 2. Instantiate and pass through scheduler

**`packages/agent/src/workflow-scheduler.ts`**:

- Import and instantiate `SchedulerStateManager` as a class member
- Pass it in `createExecutionContext()`:
  ```typescript
  private createExecutionContext(): HandlerExecutionContext {
    return {
      api: this.api,
      connectionManager: this.connectionManager,
      userPath: this.userPath,
      schedulerState: this.schedulerState,  // NEW
    };
  }
  ```

#### 3. Set dirty on event publish

**`packages/agent/src/tools/topics.ts`** — `makeTopicsPublishTool()`:

Add an optional `onPublish` callback parameter:

```typescript
export function makeTopicsPublishTool(
  eventStore: EventStore,
  getWorkflowId: () => string | undefined,
  getHandlerRunId: () => string | undefined,
  getPhase?: () => 'producer' | 'next' | null,
  getHandlerName?: () => string | undefined,
  getWorkflowConfig?: () => WorkflowConfig | undefined,
  onPublish?: (topicName: string) => void  // NEW
)
```

After publishing each event (line ~403), call `onPublish?.(topicName)`.

**`packages/agent/src/sandbox/tool-lists.ts`** — wire the callback:

```typescript
makeTopicsPublishTool(
  api.eventStore, getWorkflowId, getHandlerRunId, getPhase, getHandlerName, getWorkflowConfig,
  (topicName) => {  // NEW: onPublish callback
    const wfId = getWorkflowId();
    const config = getWorkflowConfig();
    if (wfId && config && schedulerState) {
      schedulerState.onEventPublish(wfId, topicName, config);
    }
  }
)
```

The `schedulerState` reference comes from the context that `tool-lists.ts` already has access to (via config parameter or closure). Check how `tool-lists.ts` gets its config and thread `schedulerState` through accordingly.

Note: The `api.ts` call site (planner/maintainer sandbox) does NOT need dirty flag tracking — those are task-mode tools, not handler execution.

#### 4. Clear dirty on consumer commit

**`packages/agent/src/handler-state-machine.ts`** — in `consumerPhases.prepared` and `consumerPhases.emitting`:

After `commitConsumer()` returns, clear the dirty flag:

```typescript
// In prepared phase (empty reservations path):
await commitConsumer(api, run, undefined);
context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name);

// In emitting phase (after next handler or no-next commit):
await commitConsumer(api, run, result.result);
context.schedulerState?.onConsumerCommit(run.workflow_id, run.handler_name);
```

Note: `prepared` handler currently declares `(api, run)` but the PhaseHandler type passes context as third arg. Add `context` parameter to the handler signatures that need it.

#### 4b. Set wakeAt in `SchedulerStateManager` when prepare stores it

**`packages/agent/src/handler-state-machine.ts`** — in `savePrepareAndReserve()`:

After `handlerStateStore.updateWakeAt(workflowId, handlerName, wakeAtMs, tx)`, also update in-memory cache:

```typescript
context.schedulerState?.setWakeAt(run.workflow_id, run.handler_name, wakeAtMs);
```

The context is available in `savePrepareAndReserve` — it's called from `consumerPhases.preparing` which receives context.

#### 5. Simplify `findConsumerWithPendingWork` — no DB queries for events

**`packages/agent/src/session-orchestration.ts`**:

Add `schedulerState` parameter:

```typescript
export async function findConsumerWithPendingWork(
  api: KeepDbApi,
  workflow: Workflow,
  schedulerState?: SchedulerStateManager  // NEW
): Promise<{ name: string; reason: "events" | "wakeAt" } | null> {
```

Replace DB queries with pure in-memory checks:

```typescript
// Check dirty consumers (event-driven) — in-memory
for (const [consumerName] of Object.entries(config.consumers)) {
  if (schedulerState?.isConsumerDirty(workflow.id, consumerName)) {
    return { name: consumerName, reason: "events" };
  }
}

// Check due wakeAt (time-driven) — in-memory
if (schedulerState) {
  const dueConsumers = schedulerState.getConsumersWithDueWakeAt(workflow.id);
  for (const consumerName of dueConsumers) {
    if (config.consumers[consumerName]) {
      return { name: consumerName, reason: "wakeAt" };
    }
  }
}

return null;
```

Zero DB queries in the hot path. If `dirty=true` but events were somehow cleaned up, consumer runs prepare, gets nothing, commits, dirty clears — one wasted prepare but self-correcting.

Update call sites in `executeWorkflowSession` and `continueSession` to pass `context.schedulerState`.

#### 6. Check dirty in scheduler Priority 3

**`packages/agent/src/workflow-scheduler.ts`** — replace the current hotfix:

```typescript
// Check if any consumer is dirty (new events since last run) — in-memory
const dirtyConsumers = this.schedulerState.getDirtyConsumers(workflow.id);
if (dirtyConsumers.length > 0) {
  dueWorkflows.push({ workflow, trigger: 'event' });
  this.debug(`Workflow ${workflow.id} (${workflow.title}) has consumer-only work (${dirtyConsumers.length} dirty consumers)`);
  continue;
}

// Check for due wakeAt times — in-memory
const dueConsumers = this.schedulerState.getConsumersWithDueWakeAt(workflow.id);
if (dueConsumers.length > 0) {
  dueWorkflows.push({ workflow, trigger: 'event' });
  this.debug(`Workflow ${workflow.id} (${workflow.title}) has consumer-only work (due wakeAt)`);
}
```

This replaces the hotfix (countPendingByTopic) and the original broken check (hasAnyPendingForWorkflow). Zero DB queries — dirty flag and wakeAt cache are the source of truth on the scheduler hot path.

### Initialization

**On workflow deploy** (save/fix tool after `handler_config` is stored):
Call `schedulerState.initializeForWorkflow(workflowId, config)` — sets all consumers `dirty = true`.

This needs the scheduler state to be accessible from the save/fix tool context. The save/fix tools run in the agent (planner/maintainer) context, not the handler context. Two options:
- Pass schedulerState through the agent's tool context
- Have the scheduler detect new deploys on next tick and initialize then

Go with option B (simpler): on each scheduler tick, for any active workflow whose consumers aren't tracked in schedulerState yet, call `initializeForWorkflow`. This naturally handles restarts too.

**On restart**:
In `WorkflowScheduler.start()`, after `resumeIncompleteSessions()`, iterate active workflows:
1. Call `schedulerState.initializeForWorkflow(workflowId, config)` — sets all consumers dirty
2. Load persisted wakeAt values from `handler_state` table and call `schedulerState.setWakeAt()` for each

This sets all consumers dirty (conservative — may cause one extra prepare per consumer, which is safe per spec: handlers are idempotent) and restores time-based scheduling from DB.

### Within-Session Flow

The dirty flag handles the within-session busy-loop automatically:

1. `findConsumerWithPendingWork()` → consumer has pending events AND dirty=true → returns it
2. Consumer runs prepare → returns empty reservations (or non-empty, doesn't matter)
3. Consumer commits → `onConsumerCommit()` → dirty=false
4. If consumer's `next` phase publishes to another consumer's topic → `onEventPublish()` → that consumer dirty=true
5. Loop calls `findConsumerWithPendingWork()` again → original consumer dirty=false → skipped
6. If another consumer is dirty, it runs; otherwise "no more work" → session ends

No need for separate "within-session tracking" — the dirty flag is the single mechanism.

**Files**:
- `packages/agent/src/handler-state-machine.ts` (context type + clear dirty on commit)
- `packages/agent/src/workflow-scheduler.ts` (instantiate, pass, Priority 3 check, init on start)
- `packages/agent/src/session-orchestration.ts` (pass to findConsumerWithPendingWork, check dirty)
- `packages/agent/src/tools/topics.ts` (onPublish callback)
- `packages/agent/src/sandbox/tool-lists.ts` (wire onPublish callback)

---

## Fix 2: Script Validation — Orphaned Topic Detection

**Problem**: A script can declare a topic and publish to it without any consumer subscribing. Events accumulate with no consumer to process them.

**Fix**: Add validation in `workflow-validator.ts` VALIDATION_CODE. After the existing topic-graph checks (line 224), add:

```javascript
// Reject topics published to but not subscribed by any consumer
const publishedTopics = new Set();
for (const p of Object.values(producerConfig)) {
  for (const t of p.publishes) publishedTopics.add(t);
}
for (const c of Object.values(consumerConfig)) {
  for (const t of c.publishes) publishedTopics.add(t);
}
const subscribedTopics = new Set();
for (const c of Object.values(consumerConfig)) {
  for (const t of c.subscribe) subscribedTopics.add(t);
}
for (const topic of publishedTopics) {
  if (!subscribedTopics.has(topic)) {
    throw new Error(`Topic '${topic}' is published to but no consumer subscribes to it`);
  }
}
```

Hard error — script won't save. Applies to both save and fix tools since both call `validateWorkflowScript()`. The fix tool (maintainer) would get the validation error as feedback and correct the script.

**Files**: `packages/agent/src/workflow-validator.ts`

---

## Fix 3: Clean Up Dead Code

`scheduler-state.ts` is being wired up (no longer dead). Nothing to clean up there.

**`consumer_sleep_until`**: Leave as-is (column exists but unused). Not worth the migration risk.

---

## Verification

1. **Build**: `turbo run build` — verify no type errors
2. **Existing tests**: `turbo run test` — verify no regressions
3. **Orphaned topic validation**: Write a test that a script publishing to a topic with no subscriber is rejected
4. **Dirty flag tests**:
   - Consumer commits → dirty=false → does NOT re-trigger in same session loop
   - Consumer commits → dirty=false → scheduler Priority 3 does NOT trigger session
   - New event publish → dirty=true → consumer re-triggers
   - On restart/init, all consumers are dirty=true → runs prepare once
5. **Manual**: Run the server with the problem workflow, verify no more tight loop
