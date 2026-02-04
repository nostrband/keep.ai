# exec-13: Per-Producer Scheduling

## Problem

The docs (16-scheduling.md) define per-producer scheduling:
- Each producer has its own schedule (interval or cron)
- Each producer has its own `next_run_at`
- Producers don't interfere with each other's schedules

Current implementation:
- Single `workflows.next_run_timestamp` for entire workflow
- Producer A (every 5 min) and Producer B (every 1 hour) share one timestamp
- When A runs, B's schedule is affected

**Key distinction from consumer wakeAt:**
- Producer schedules are **pre-declared** (static config)
- Consumer wakeAt is **returned** from prepare (dynamic)

Both need per-handler tracking, but stored differently:
- `producer_schedules` table - tracks `next_run_at` per producer (from config)
- `handler_state.wake_at` - tracks `wakeAt` per consumer (from PrepareResult)

## Solution

### 1. Producer Schedules Table

```sql
CREATE TABLE producer_schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  producer_name TEXT NOT NULL,

  -- Schedule config (copied from handler_config for quick access)
  schedule_type TEXT NOT NULL,       -- 'interval' | 'cron'
  schedule_value TEXT NOT NULL,      -- '5m' or '0 * * * *'

  -- Runtime state
  next_run_at INTEGER NOT NULL,      -- When to run next
  last_run_at INTEGER,               -- When last ran (for debugging)

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(workflow_id, producer_name)
);

CREATE INDEX idx_producer_schedules_workflow ON producer_schedules(workflow_id);
CREATE INDEX idx_producer_schedules_next_run ON producer_schedules(next_run_at);

SELECT crsql_as_crr('producer_schedules');
```

### 2. ProducerScheduleStore

```typescript
class ProducerScheduleStore {
  // Initialize schedules from workflow config
  async initializeForWorkflow(workflowId: string, config: WorkflowConfig): Promise<void> {
    const now = Date.now();

    for (const [name, producer] of Object.entries(config.producers)) {
      const schedule = producer.schedule;
      const scheduleType = schedule.interval ? 'interval' : 'cron';
      const scheduleValue = schedule.interval || schedule.cron;

      await this.db.run(`
        INSERT INTO producer_schedules
          (id, workflow_id, producer_name, schedule_type, schedule_value, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id, producer_name) DO UPDATE SET
          schedule_type = excluded.schedule_type,
          schedule_value = excluded.schedule_value,
          updated_at = excluded.updated_at
      `, [generateId(), workflowId, name, scheduleType, scheduleValue, now, now, now]);
    }
  }

  // Get schedule for a producer
  async get(workflowId: string, producerName: string): Promise<ProducerSchedule | null> {
    return this.db.get(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? AND producer_name = ?`,
      [workflowId, producerName]
    );
  }

  // Get all schedules for a workflow
  async getForWorkflow(workflowId: string): Promise<ProducerSchedule[]> {
    return this.db.all(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? ORDER BY next_run_at`,
      [workflowId]
    );
  }

  // Get producers that are due to run
  async getDueProducers(workflowId: string): Promise<ProducerSchedule[]> {
    const now = Date.now();
    return this.db.all(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? AND next_run_at <= ?`,
      [workflowId, now]
    );
  }

  // Update after producer runs
  async updateAfterRun(workflowId: string, producerName: string): Promise<void> {
    const schedule = await this.get(workflowId, producerName);
    if (!schedule) return;

    const now = Date.now();
    const nextRunAt = computeNextRunTime(schedule.schedule_type, schedule.schedule_value);

    await this.db.run(`
      UPDATE producer_schedules
      SET next_run_at = ?, last_run_at = ?, updated_at = ?
      WHERE workflow_id = ? AND producer_name = ?
    `, [nextRunAt, now, now, workflowId, producerName]);
  }

  // Get next scheduled time across all producers
  async getNextScheduledTime(workflowId: string): Promise<number | null> {
    const result = await this.db.get(
      `SELECT MIN(next_run_at) as next FROM producer_schedules WHERE workflow_id = ?`,
      [workflowId]
    );
    return result?.next ?? null;
  }
}
```

### 3. Compute Next Run Time

```typescript
function computeNextRunTime(scheduleType: string, scheduleValue: string): number {
  const now = Date.now();

  if (scheduleType === 'cron') {
    const cron = new Croner(scheduleValue);
    const next = cron.nextRun();
    return next?.getTime() ?? now + 60000;  // Fallback to 1 min if cron invalid
  }

  if (scheduleType === 'interval') {
    const intervalMs = parseInterval(scheduleValue);
    return now + intervalMs;
  }

  throw new Error(`Invalid schedule type: ${scheduleType}`);
}

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid interval: ${interval}`);

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}
```

### 4. Scheduler State (In-Memory)

Uses the unified `SchedulerStateManager` from exec-11 which provides:

```typescript
// From exec-11 SchedulerStateManager:
schedulerState.setProducerQueued(workflowId, producerName, true);
schedulerState.isProducerQueued(workflowId, producerName);
schedulerState.onProducerCommit(workflowId, producerName);
```

### 5. Scheduler Logic

```typescript
class WorkflowScheduler {
  /**
   * Find runnable producer using batch query to avoid N+1.
   * Returns first producer that should run, or null.
   */
  async findRunnableProducer(workflowId: string): Promise<string | null> {
    const now = Date.now();

    // Batch query: get all schedules for this workflow
    const schedules = await this.producerScheduleStore.getForWorkflow(workflowId);

    for (const schedule of schedules) {
      // Check in-memory queued flag first (no DB query)
      if (this.schedulerState.isProducerQueued(workflowId, schedule.producer_name)) {
        return schedule.producer_name;
      }

      // Check persisted schedule (already have from batch query)
      if (now >= schedule.next_run_at) {
        return schedule.producer_name;
      }
    }

    return null;
  }

  // Handle schedule fire for specific producer
  async onProducerScheduleFire(workflowId: string, producerName: string): Promise<void> {
    const workflow = await this.workflowStore.get(workflowId);
    if (workflow.status !== 'active') return;

    if (await this.hasActiveRun(workflowId)) {
      // Workflow busy - queue this producer
      this.schedulerState.setProducerQueued(workflowId, producerName, true);
      return;
    }

    await this.startProducerRun(workflowId, producerName);
  }

  // Main tick - check all workflows
  async tick(): Promise<void> {
    const now = Date.now();

    // Find workflows with due producers
    const dueSchedules = await this.db.all(`
      SELECT DISTINCT ps.workflow_id
      FROM producer_schedules ps
      JOIN workflows w ON w.id = ps.workflow_id
      WHERE ps.next_run_at <= ? AND w.status = 'active'
    `, [now]);

    for (const { workflow_id } of dueSchedules) {
      if (await this.hasActiveRun(workflow_id)) {
        // Queue all due producers for this workflow
        const due = await this.producerScheduleStore.getDueProducers(workflow_id);
        for (const schedule of due) {
          this.schedulerState.setProducerQueued(workflow_id, schedule.producer_name, true);
        }
      } else {
        // Start session
        await this.startSession(workflow_id, 'schedule');
      }
    }
  }
}
```

### 6. Commit Producer - Update Per-Producer Schedule

```typescript
async function commitProducer(run: HandlerRun, newState: any): Promise<void> {
  await db.transaction(async (tx) => {
    // Update handler state
    if (newState !== undefined) {
      await handlerStateStore.set(run.workflow_id, run.handler_name, newState, run.id, tx);
    }

    // Update THIS producer's next_run_at (not workflow-level)
    await producerScheduleStore.updateAfterRun(run.workflow_id, run.handler_name, tx);

    // Clear queued flag for this producer
    schedulerState.clearProducerQueued(run.workflow_id, run.handler_name);

    // Mark run committed
    await handlerRunStore.update(run.id, {
      phase: 'committed',
      status: 'committed',
      output_state: JSON.stringify(newState),
      end_timestamp: new Date().toISOString(),
    }, tx);
  });
}
```

### 7. Restart Recovery

```typescript
async function recoverProducerSchedules(): Promise<void> {
  const now = Date.now();

  // Find all due producers
  const dueSchedules = await db.all(`
    SELECT ps.*, w.status as workflow_status
    FROM producer_schedules ps
    JOIN workflows w ON w.id = ps.workflow_id
    WHERE ps.next_run_at <= ? AND w.status = 'active'
  `, [now]);

  for (const schedule of dueSchedules) {
    // Set queued flag - will be picked up by next tick
    schedulerState.setProducerQueued(schedule.workflow_id, schedule.producer_name, true);
    log.info(`Producer ${schedule.producer_name} queued (missed during downtime)`);
  }
}
```

### 8. Manual Trigger

```typescript
async function triggerManualRun(workflowId: string): Promise<void> {
  if (await hasActiveRun(workflowId)) {
    throw new ManualTriggerRejectedError(
      'Another run is active. Please wait for it to complete.'
    );
  }

  // Queue ALL producers for this workflow
  const schedules = await producerScheduleStore.getForWorkflow(workflowId);
  for (const schedule of schedules) {
    schedulerState.setProducerQueued(workflowId, schedule.producer_name, true);
  }

  // Start session
  await startSession(workflowId, 'manual');
}
```

### 9. Initialize on Workflow Deploy/Update

```typescript
async function onWorkflowDeploy(workflowId: string, config: WorkflowConfig): Promise<void> {
  // Initialize producer schedules from config
  await producerScheduleStore.initializeForWorkflow(workflowId, config);

  // Set consumer dirty flags (in-memory)
  for (const consumerName of Object.keys(config.consumers)) {
    schedulerState.setConsumerDirty(workflowId, consumerName, true);
  }
}

async function onWorkflowConfigUpdate(workflowId: string, config: WorkflowConfig): Promise<void> {
  // Re-initialize schedules (handles added/removed producers)
  await producerScheduleStore.initializeForWorkflow(workflowId, config);

  // Remove schedules for deleted producers
  const existingSchedules = await producerScheduleStore.getForWorkflow(workflowId);
  for (const schedule of existingSchedules) {
    if (!config.producers[schedule.producer_name]) {
      await producerScheduleStore.delete(workflowId, schedule.producer_name);
    }
  }
}
```

### 10. Deprecate workflows.next_run_timestamp

```sql
-- Migration: Mark as deprecated
-- Don't drop yet, but stop using it
-- ALTER TABLE workflows DROP COLUMN next_run_timestamp;  -- Later
```

## Database Changes

```sql
-- New table for per-producer scheduling
CREATE TABLE producer_schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workflow_id, producer_name)
);

CREATE INDEX idx_producer_schedules_workflow ON producer_schedules(workflow_id);
CREATE INDEX idx_producer_schedules_next_run ON producer_schedules(next_run_at);

SELECT crsql_as_crr('producer_schedules');
```

## Migration

1. Create `producer_schedules` table
2. Create `ProducerScheduleStore`
3. Update `onWorkflowDeploy` to initialize schedules
4. Update scheduler to use per-producer schedules
5. Update `commitProducer` to update per-producer `next_run_at`
6. Stop using `workflows.next_run_timestamp`

## Testing

- Test two producers with different intervals run independently
- Test producer A (5 min) doesn't affect producer B (1 hour) schedule
- Test queued flag per-producer
- Test restart recovery queues correct producers
- Test manual trigger queues all producers
- Test config update handles added/removed producers

## References

- docs/dev/16-scheduling.md - Producer Scheduling section
- exec-11 for comparison with consumer wakeAt (per-handler but dynamic)
