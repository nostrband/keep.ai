# exec-10: Retry Chain and Phase Reset Rules

## Problem

The docs (16-scheduling.md) define that each execution attempt is a **separate run record** linked via `retry_of`:

> Each execution attempt is stored as a separate **run record**. This preserves full history for observability and debugging.

But exec-01 database schema and exec-06 state machine:
- Have no `retry_of` column
- Don't create new runs on retry
- Don't copy prepare_result/mutation_result to retry runs
- Don't implement phase reset rules from doc

## Solution

### 1. Add retry_of Column

```sql
-- Migration v37 (or v38)
ALTER TABLE handler_runs ADD COLUMN retry_of TEXT;
-- Links to previous attempt's handler_run.id (nullable for first attempt)
```

### 2. Phase Reset Rules Implementation

From doc 16-scheduling.md:

| Current Phase | Mutation Applied? | Action |
|---------------|-------------------|--------|
| `preparing` | No | New run starts fresh from `preparing` |
| `prepared` | No | New run starts fresh from `preparing` |
| `mutating` | No | New run starts fresh from `preparing` |
| `mutated` | **Yes** | New run copies results, starts at `emitting` |
| `emitting` | **Yes** | New run copies results, retries `emitting` |

**Key insight**: Check `phase >= mutated` to know if mutation was applied.

```typescript
function shouldCopyResults(phase: ConsumerPhase): boolean {
  // After mutation is applied, we must proceed forward with existing results
  return phase === 'mutated' || phase === 'emitting';
}

function getStartPhaseForRetry(previousPhase: ConsumerPhase): ConsumerPhase {
  if (shouldCopyResults(previousPhase)) {
    // Can't reset - mutation happened
    return 'emitting';  // Resume from emitting
  }
  // Before mutation - start fresh
  return 'preparing';
}
```

### 3. Create Retry Run Function

**Important**: Marking previous run failed and creating retry must be atomic.

```typescript
interface CreateRetryRunParams {
  previousRun: HandlerRun;
  previousRunStatus: RunStatus;  // Status to set on previous run
  reason: 'transient' | 'logic_fix' | 'crashed_recovery' | 'user_retry';
}

async function createRetryRun(params: CreateRetryRunParams): Promise<HandlerRun> {
  const { previousRun, previousRunStatus, reason } = params;

  const startPhase = getStartPhaseForRetry(previousRun.phase as ConsumerPhase);
  const copyResults = shouldCopyResults(previousRun.phase as ConsumerPhase);

  // Atomic: update previous run status AND create new run
  return await db.transaction(async (tx) => {
    // 1. Mark previous run with final status
    await handlerRunStore.update(previousRun.id, {
      status: previousRunStatus,
      end_timestamp: new Date().toISOString(),
    }, tx);

    // 2. Create new retry run
    const newRun = await handlerRunStore.create({
      script_run_id: previousRun.script_run_id,
      workflow_id: previousRun.workflow_id,
      handler_type: previousRun.handler_type,
      handler_name: previousRun.handler_name,

      // Link to previous attempt
      retry_of: previousRun.id,

      // Phase reset or continue from emitting
      phase: startPhase,
      status: 'active',

      // Copy results if mutation was applied
      prepare_result: copyResults ? previousRun.prepare_result : null,
      // Mutation result comes from mutations table, not copied here

      // Fresh state tracking
      input_state: previousRun.input_state,  // Same input state
      start_timestamp: new Date().toISOString(),
    }, tx);

    return newRun;
  });
}
```

### 4. Update Restart Recovery

From doc 16-scheduling.md:

> On host restart, incomplete runs are detected and recovered:
> 1. Find runs with `status=active` → mark as `status=crashed`
> 2. For each crashed run, create recovery run with `retry_of` pointing to it
> 3. Recovery run applies phase reset rules

```typescript
async function recoverCrashedRuns(): Promise<void> {
  // Find runs that were active when host crashed
  const activeRuns = await handlerRunStore.findByStatus('active');

  for (const run of activeRuns) {
    // 1. Mark as crashed (preserves the record)
    await handlerRunStore.update(run.id, {
      status: 'crashed',
      end_timestamp: new Date().toISOString(),
    });

    // 2. Check mutation status for runs in mutating phase
    if (run.phase === 'mutating') {
      const mutation = await mutationStore.getByHandlerRunId(run.id);
      if (mutation?.status === 'in_flight') {
        // Uncertain outcome - mark indeterminate, don't auto-retry
        await mutationStore.update(mutation.id, { status: 'indeterminate' });
        // Don't create retry run - needs reconciliation
        continue;
      }
    }

    // 3. Create recovery run with retry_of
    await createRetryRun({
      previousRun: run,
      reason: 'crashed_recovery',
    });
  }
}
```

### 5. Retry Flow Examples

**Transient failure (e.g., rate limit in prepare):**

```
Run A: phase=preparing, status=paused:transient
    ↓ (backoff delay)
Run B: retry_of=A, phase=preparing (fresh start), status=active
    ↓ (success)
Run B: phase=committed, status=committed
```

**Logic error with auto-fix (e.g., script throws in prepare):**

```
Run A: phase=preparing, status=failed:logic
    ↓ (auto-fix produces new script version)
Run B: retry_of=A, phase=preparing (fresh start with new script), status=active
    ↓ (success or fail again)
```

**Failure after mutation applied (e.g., error in next):**

```
Run A: mutation succeeds, phase=emitting, status=failed:logic
    ↓ (auto-fix produces new script version)
Run B: retry_of=A, copies prepare_result, phase=emitting, status=active
    ↓ (next executes with same inputs)
Run B: phase=committed, status=committed
```

### 6. Query Helpers

```typescript
// Get retry chain for a run (for UI/debugging)
async function getRetryChain(runId: string): Promise<HandlerRun[]> {
  const chain: HandlerRun[] = [];
  let currentId: string | null = runId;

  while (currentId) {
    const run = await handlerRunStore.get(currentId);
    if (!run) break;
    chain.unshift(run);  // Add to beginning (oldest first)
    currentId = run.retry_of;
  }

  return chain;
}

// Get latest attempt for a handler run chain
async function getLatestAttempt(originalRunId: string): Promise<HandlerRun | null> {
  // Find runs where retry_of eventually leads to originalRunId
  return handlerRunStore.findLatestInChain(originalRunId);
}
```

### 7. Update Session Orchestration

When a handler fails, don't immediately retry in the same session. Instead:

```typescript
// In session execution loop
const result = await executeHandler(handlerRun.id);

if (result.status === 'paused:transient') {
  // Session pauses, scheduler will create retry after backoff
  await pauseSession(session, 'transient_failure');
  return { status: 'suspended', reason: 'handler_transient' };
}

if (result.status === 'failed:logic') {
  // Session pauses, auto-fix will create retry with new script
  await pauseSession(session, 'logic_error');
  return { status: 'suspended', reason: 'handler_logic_error' };
}
```

## Database Changes

```sql
ALTER TABLE handler_runs ADD COLUMN retry_of TEXT;
CREATE INDEX idx_handler_runs_retry_of ON handler_runs(retry_of);
```

## Migration

1. Add `retry_of` column
2. Existing runs get `retry_of = NULL` (they're all first attempts)
3. Update state machine to use createRetryRun
4. Update session orchestration to handle retry semantics

## Testing

- Test fresh start for failures before mutation
- Test results copying for failures after mutation
- Test retry chain links correctly
- Test crash recovery creates new runs with retry_of
- Test getRetryChain returns correct order
- Test indeterminate mutations don't auto-retry

## References

- docs/dev/16-scheduling.md - Run Records, Phase Reset Rules, Retry Flow sections
- docs/dev/06-execution-model.md - Phase Reset section
