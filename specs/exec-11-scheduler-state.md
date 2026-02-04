# exec-11: Scheduler State and wakeAt Implementation

## Problem

The docs (16-scheduling.md) define comprehensive scheduler state:

**Persisted State:**
- Producer `next_run_at` - stored ✓ (partially implemented)
- Consumer `wakeAt` - from PrepareResult, **per-consumer** (NOT implemented)
- Handler `state` - stored ✓

**In-Memory State:**
- `dirty` flag - new events arrived since last run (consumer-only, NOT implemented)
- `queued` flag - schedule fired during active run (producer-only, see exec-13)

The current implementation:
- Has `consumer_sleep_until` column on workflows (per-workflow, wrong granularity)
- PrepareResult interface lacks `wakeAt` field
- No dirty/queued flag tracking
- No coalescing of queued triggers

## Concurrency Model

**Single-threaded scheduler is the locking mechanism.**

The scheduler runs in a single thread and checks `hasActiveRun(workflowId)` before starting any handler. This ensures:
- Only one handler runs per workflow at a time
- No explicit locks or mutexes needed
- If wakeAt or schedule fires while workflow is busy, we just set flags and pick up on next tick

```typescript
// In scheduler tick:
if (await this.hasActiveRun(workflowId)) {
  // Don't start - workflow already has an active run
  // Set queued/dirty flags for next tick
  return;
}
// Safe to start handler
await this.startRun(workflowId, handlerName);
```

## Solution

### 1. Add wakeAt to PrepareResult

In `packages/agent/src/handler-state-machine.ts` or types file:

```typescript
interface PrepareResult {
  reservations: Array<{
    topic: string;
    ids: string[];
  }>;
  data: Record<string, unknown>;
  ui?: Record<string, unknown>;  // Optional UX metadata
  wakeAt?: string;  // ISO 8601 datetime for time-based wake
}
```

### 2. Store wakeAt Per-Consumer

The doc says `wakeAt` is persisted per-consumer:

> | `wakeAt` | Consumer | From PrepareResult; resumes time-based scheduling |

**Why per-consumer matters:**
- Consumer A (daily digest): `wakeAt: "2024-01-16T09:00:00Z"`
- Consumer B (batch timeout): `wakeAt: "2024-01-15T14:00:00Z"`
- Each needs its own wake time; per-workflow would lose one

**Decision**: Add `wake_at` column to `handler_state` table:

```sql
ALTER TABLE handler_state ADD COLUMN wake_at INTEGER;
```

### 3. Unified Scheduler State (In-Memory)

Create `packages/agent/src/scheduler-state.ts`:

```typescript
/**
 * Unified in-memory scheduler state for both consumers and producers.
 * - Consumer: dirty flag (new events arrived)
 * - Producer: queued flag (schedule fired while busy)
 *
 * These flags are recovered from DB on restart - see recovery sections.
 */

interface ConsumerSchedulerState {
  dirty: boolean;  // New events arrived since last run
}

interface ProducerSchedulerState {
  queued: boolean;  // Schedule fired while workflow busy
}

class SchedulerStateManager {
  // Consumer states: workflowId -> consumerName -> state
  private consumerStates: Map<string, Map<string, ConsumerSchedulerState>> = new Map();

  // Producer states: workflowId -> producerName -> state
  private producerStates: Map<string, Map<string, ProducerSchedulerState>> = new Map();

  // ==================== Consumer Methods ====================

  // Called when event is published to topic
  onEventPublish(workflowId: string, topicName: string, config: WorkflowConfig): void {
    for (const [consumerName, consumer] of Object.entries(config.consumers)) {
      if (consumer.subscribe.includes(topicName)) {
        this.setConsumerDirty(workflowId, consumerName, true);
      }
    }
  }

  // Called when consumer run commits
  onConsumerCommit(workflowId: string, consumerName: string): void {
    this.setConsumerDirty(workflowId, consumerName, false);
  }

  setConsumerDirty(workflowId: string, consumerName: string, dirty: boolean): void {
    this.getConsumerState(workflowId, consumerName).dirty = dirty;
  }

  isConsumerDirty(workflowId: string, consumerName: string): boolean {
    return this.getConsumerState(workflowId, consumerName).dirty;
  }

  private getConsumerState(workflowId: string, consumerName: string): ConsumerSchedulerState {
    let workflow = this.consumerStates.get(workflowId);
    if (!workflow) {
      workflow = new Map();
      this.consumerStates.set(workflowId, workflow);
    }

    let consumer = workflow.get(consumerName);
    if (!consumer) {
      consumer = { dirty: false };
      workflow.set(consumerName, consumer);
    }

    return consumer;
  }

  // ==================== Producer Methods ====================

  // Called when producer schedule fires while workflow is busy
  setProducerQueued(workflowId: string, producerName: string, queued: boolean): void {
    this.getProducerState(workflowId, producerName).queued = queued;
  }

  isProducerQueued(workflowId: string, producerName: string): boolean {
    return this.getProducerState(workflowId, producerName).queued;
  }

  // Called when producer run commits
  onProducerCommit(workflowId: string, producerName: string): void {
    this.setProducerQueued(workflowId, producerName, false);
  }

  private getProducerState(workflowId: string, producerName: string): ProducerSchedulerState {
    let workflow = this.producerStates.get(workflowId);
    if (!workflow) {
      workflow = new Map();
      this.producerStates.set(workflowId, workflow);
    }

    let producer = workflow.get(producerName);
    if (!producer) {
      producer = { queued: false };
      workflow.set(producerName, producer);
    }

    return producer;
  }

  // ==================== Cleanup ====================

  clearWorkflow(workflowId: string): void {
    this.consumerStates.delete(workflowId);
    this.producerStates.delete(workflowId);
  }
}
```

**Why consumers don't need `queued`:**
- If wakeAt fires while workflow is busy → wakeAt is persisted in DB, scheduler picks it up next tick
- If events arrive while workflow is busy → set `dirty=true`, scheduler picks it up next tick

**Why producers need `queued`:**
- Producer schedules are time-based, not event-based
- If schedule fires at 10:00:00 but workflow is busy, we need to remember to run when free
- The `next_run_at` in DB will be updated to 10:05:00 (next interval), losing the 10:00:00 trigger
- `queued` flag preserves the "should run" state until workflow becomes idle

### 3b. Config Cache

Avoid repeated `JSON.parse(workflow.handler_config)` calls:

```typescript
class ConfigCache {
  private cache: Map<string, { config: WorkflowConfig; version: number }> = new Map();

  /**
   * Get cached config, parsing only if not cached or version changed.
   * Version is typically workflow.updated_at timestamp.
   */
  get(workflowId: string, rawConfig: string, version: number): WorkflowConfig {
    const cached = this.cache.get(workflowId);

    if (cached && cached.version === version) {
      return cached.config;
    }

    const config = JSON.parse(rawConfig) as WorkflowConfig;
    this.cache.set(workflowId, { config, version });
    return config;
  }

  invalidate(workflowId: string): void {
    this.cache.delete(workflowId);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Usage in scheduler:
const config = this.configCache.get(
  workflow.id,
  workflow.handler_config,
  workflow.updated_at
);
```

### 4. Scheduler Logic Implementation

From doc 16-scheduling.md - implement the core logic:

```typescript
class WorkflowScheduler {
  constructor(
    private schedulerState: SchedulerStateManager,
    private handlerStateStore: HandlerStateStore,
  ) {}

  /**
   * Find runnable consumer using batch queries to avoid N+1.
   * Returns first consumer that should run, or null.
   */
  async findRunnableConsumer(workflowId: string, config: WorkflowConfig): Promise<string | null> {
    const now = Date.now();
    const consumerNames = Object.keys(config.consumers);

    // 1. Check in-memory dirty flags first (no DB query)
    for (const consumerName of consumerNames) {
      if (this.schedulerState.isConsumerDirty(workflowId, consumerName)) {
        return consumerName;
      }
    }

    // 2. Batch query: get all handler states for this workflow
    const allStates = await this.handlerStateStore.getForWorkflow(workflowId);
    const stateByName = new Map(allStates.map(s => [s.handler_name, s]));

    // Check wakeAt for each consumer
    for (const consumerName of consumerNames) {
      const state = stateByName.get(consumerName);
      if (state?.wake_at && now >= state.wake_at) {
        return consumerName;
      }
    }

    // 3. Batch query: check for pending events across all topics
    const allTopics = new Set<string>();
    for (const consumer of Object.values(config.consumers)) {
      for (const topic of consumer.subscribe) {
        allTopics.add(topic);
      }
    }

    const pendingByTopic = await this.eventStore.countPendingByTopic(workflowId, [...allTopics]);

    // Find consumer with pending events
    for (const [consumerName, consumer] of Object.entries(config.consumers)) {
      for (const topic of consumer.subscribe) {
        if ((pendingByTopic.get(topic) ?? 0) > 0) {
          return consumerName;
        }
      }
    }

    return null;
  }

  // Note: findRunnableProducer is in exec-13
}
```

### 5. Handle wakeAt in State Machine

Update consumer execution to record wakeAt per-consumer:

```typescript
// In preparing phase handler
async function handlePreparing(run: HandlerRun): Promise<void> {
  // ... execute prepare ...

  const prepareResult = await executePrepare(run);

  // Process wakeAt - always record when provided (per doc)
  let clampedWakeAt: number | null = null;

  if (prepareResult.wakeAt) {
    const wakeAt = new Date(prepareResult.wakeAt).getTime();
    const now = Date.now();

    // Host-enforced constraints (from doc)
    const MIN_WAKE_INTERVAL = 30 * 1000;           // 30 seconds
    const MAX_WAKE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

    // Clamp to valid range
    clampedWakeAt = Math.max(
      now + MIN_WAKE_INTERVAL,
      Math.min(wakeAt, now + MAX_WAKE_INTERVAL)
    );
  }

  // Store wakeAt in handler_state (per-consumer)
  await handlerStateStore.updateWakeAt(
    run.workflow_id,
    run.handler_name,
    clampedWakeAt  // null clears it
  );

  // ... continue with reservations ...
}
```

### 6. HandlerStateStore Updates

```typescript
class HandlerStateStore {
  // Get single handler state
  async get(workflowId: string, handlerName: string): Promise<HandlerState | null> {
    return this.db.get(
      `SELECT * FROM handler_state WHERE workflow_id = ? AND handler_name = ?`,
      [workflowId, handlerName]
    );
  }

  // Batch: Get all handler states for a workflow (avoids N+1 queries)
  async getForWorkflow(workflowId: string): Promise<HandlerState[]> {
    return this.db.all(
      `SELECT * FROM handler_state WHERE workflow_id = ?`,
      [workflowId]
    );
  }

  // Update just the wake_at field
  async updateWakeAt(
    workflowId: string,
    handlerName: string,
    wakeAt: number | null
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO handler_state (id, workflow_id, handler_name, state, wake_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)
       ON CONFLICT(workflow_id, handler_name) DO UPDATE SET
         wake_at = excluded.wake_at,
         updated_at = excluded.updated_at`,
      [generateId(), workflowId, handlerName, wakeAt, Date.now()]
    );
  }

  // Get all consumers with active wakeAt that's due
  async getConsumersWithDueWakeAt(workflowId: string): Promise<string[]> {
    const now = Date.now();
    const rows = await this.db.all(
      `SELECT handler_name FROM handler_state
       WHERE workflow_id = ? AND wake_at IS NOT NULL AND wake_at <= ?`,
      [workflowId, now]
    );
    return rows.map(r => r.handler_name);
  }
}
```

### 6b. EventStore Batch Query

```typescript
class EventStore {
  // Batch: Count pending events by topic (avoids N queries per topic)
  async countPendingByTopic(
    workflowId: string,
    topicNames: string[]
  ): Promise<Map<string, number>> {
    if (topicNames.length === 0) {
      return new Map();
    }

    const placeholders = topicNames.map(() => '?').join(',');
    const rows = await this.db.all(
      `SELECT topic_name, COUNT(*) as count
       FROM events
       WHERE workflow_id = ? AND topic_name IN (${placeholders}) AND status = 'pending'
       GROUP BY topic_name`,
      [workflowId, ...topicNames]
    );

    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.topic_name, row.count);
    }
    return result;
  }
}
```

### 7. Restart Recovery for Consumer State

On restart, recover consumer dirty flags from persisted data:

```typescript
async function recoverConsumerState(): Promise<void> {
  for (const workflow of await this.getActiveWorkflows()) {
    const config = JSON.parse(workflow.handler_config);

    // For each consumer: if pending events exist → set dirty = true
    for (const [name, consumer] of Object.entries(config.consumers)) {
      const hasPending = await this.hasPendingEvents(workflow.id, consumer.subscribe);
      if (hasPending) {
        this.schedulerState.setConsumerDirty(workflow.id, name, true);
      }
    }

    // wakeAt is already persisted in handler_state - no recovery needed
    // Producer queued recovery is in exec-13
  }
}
```

### 8. Initial State on Deploy

From doc:
- Producer `next_run_at` = now → runs immediately (see exec-13)
- Consumer `dirty` = true → runs prepare immediately

```typescript
async function onWorkflowDeploy(workflowId: string): Promise<void> {
  const config = await this.getHandlerConfig(workflowId);

  // Initialize producer schedules (see exec-13)
  await producerScheduleStore.initializeForWorkflow(workflowId, config);

  // Set consumer dirty = true (in-memory)
  for (const consumerName of Object.keys(config.consumers)) {
    this.schedulerState.setConsumerDirty(workflowId, consumerName, true);
  }
}
```

### 9. Update Session Orchestration

Sessions should respect per-consumer wakeAt:

```typescript
async function findConsumerWithPendingWork(workflow: Workflow): Promise<{ name: string } | null> {
  const config = JSON.parse(workflow.handler_config);
  const now = Date.now();

  for (const [consumerName, consumerConfig] of Object.entries(config.consumers)) {
    // Check dirty flag (in-memory)
    if (schedulerState.isConsumerDirty(workflow.id, consumerName)) {
      return { name: consumerName };
    }

    // Check wakeAt (persisted, per-consumer)
    const handlerState = await handlerStateStore.get(workflow.id, consumerName);
    if (handlerState?.wake_at && now >= handlerState.wake_at) {
      return { name: consumerName };
    }

    // Check for pending events (fallback)
    for (const topicName of consumerConfig.subscribe) {
      const pendingCount = await eventStore.countPending(workflow.id, topicName);
      if (pendingCount > 0) {
        return { name: consumerName };
      }
    }
  }

  return null;
}
```

### 10. Update Script Validation

Add wakeAt to PrepareResult validation in exec-05:

```typescript
// In validation code
const prepareResult = await sandbox.eval(`
  // ... validation code ...
  const result = await workflow.consumers.${name}.prepare({});

  // Validate PrepareResult shape
  if (typeof result !== 'object' || result === null) {
    throw new Error('prepare must return an object');
  }
  if (!Array.isArray(result.reservations)) {
    throw new Error('prepare must return { reservations: [...] }');
  }
  if (result.wakeAt !== undefined && typeof result.wakeAt !== 'string') {
    throw new Error('wakeAt must be an ISO 8601 string if provided');
  }
  return result;
`);
```

## Database Changes

```sql
-- Per-consumer wakeAt storage
ALTER TABLE handler_state ADD COLUMN wake_at INTEGER;

-- Note: workflows.consumer_sleep_until can be deprecated/removed later
-- It was unused anyway
```

## Migration

1. Add `wake_at` column to `handler_state` table
2. Add wakeAt to PrepareResult interface
3. Implement SchedulerStateManager class
4. Update state machine to record wakeAt per-consumer
5. Update scheduler to check each consumer's wakeAt
6. Update validation to accept wakeAt

## Testing

- Test wakeAt clamping to min/max bounds
- Test consumer A wakes at its wakeAt while consumer B keeps its different wakeAt
- Test consumer wakes on new event before wakeAt
- Test dirty flag set on event publish
- Test dirty flag cleared on consumer commit
- Test restart recovery sets dirty for consumers with pending events
- Test wakeAt persisted and survives restart (no recovery needed)
- Test empty reservations with wakeAt schedules next run
- Test multiple consumers with different wakeAt values

## References

- docs/dev/16-scheduling.md - Scheduler State, Consumer Scheduling, wakeAt sections
- docs/dev/06-execution-model.md - Scheduling Contract section
