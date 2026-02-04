# exec-09: Separate Run Status from Phase

## Problem

The docs (06b-consumer-lifecycle.md, 16-scheduling.md) clearly define **phase** and **run status** as orthogonal concepts:

- **Phase**: Execution progress (`preparing → prepared → mutating → mutated → emitting → committed`)
- **Run Status**: Why a run is paused/stopped (`active`, `paused:transient`, `failed:logic`, etc.)

But exec-06 and the implementation conflate these:
- `handler_runs.phase` includes values like `suspended`, `failed` which are statuses, not phases
- No distinction between "paused for retry" vs "failed permanently"
- No proper failure type classification in run records

## Solution

### 1. Update Database Schema

Add `status` column to `handler_runs`, separate from `phase`:

```sql
-- Migration v37
ALTER TABLE handler_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
-- status: active, paused:transient, paused:approval, paused:reconciliation,
--         failed:logic, failed:internal, committed, crashed

-- Phase should only be execution phases
-- phase: pending, preparing, prepared, mutating, mutated, emitting, committed
-- Remove 'suspended', 'failed', 'executing' from phase values
```

### 2. Update Phase Enum

In `packages/agent/src/handler-state-machine.ts`:

```typescript
// BEFORE (wrong)
type HandlerPhase =
  | 'pending' | 'preparing' | 'prepared'
  | 'mutating' | 'mutated' | 'emitting'
  | 'committed' | 'suspended' | 'failed'  // <-- these are statuses!
  | 'executing';  // <-- producer-specific

// AFTER (correct per docs)
type ConsumerPhase =
  | 'preparing' | 'prepared'
  | 'mutating' | 'mutated'
  | 'emitting' | 'committed';

type ProducerPhase =
  | 'executing' | 'committed';

type RunStatus =
  | 'active'              // Currently executing
  | 'paused:transient'    // Transient failure, will retry
  | 'paused:approval'     // Waiting for user approval
  | 'paused:reconciliation' // Uncertain mutation outcome
  | 'failed:logic'        // Script error, auto-fix eligible
  | 'failed:internal'     // Host/connector bug
  | 'committed'           // Successfully completed
  | 'crashed';            // Found incomplete on restart
```

### 3. Update State Machine

**Critical invariant**: Status changes do not change phase. Phase only advances forward on successful completion.

```typescript
// BEFORE (wrong)
async function failRun(run: HandlerRun, error: ClassifiedError): Promise<void> {
  await handlerRunStore.update(run.id, {
    phase: 'failed',  // <-- WRONG: changing phase on failure
    error: error.message,
    error_type: error.type,
  });
}

// AFTER (correct)
async function pauseRun(run: HandlerRun, status: RunStatus, error?: string): Promise<void> {
  await handlerRunStore.update(run.id, {
    status,  // <-- only status changes
    // phase stays the same!
    error,
    error_type: classifyErrorType(error),
    end_timestamp: new Date().toISOString(),
  });
}
```

### 4. Terminal State Check

```typescript
// BEFORE
function isTerminal(phase: string): boolean {
  return ['committed', 'suspended', 'failed'].includes(phase);
}

// AFTER
function isTerminal(status: RunStatus): boolean {
  // Status determines if run is done
  return status === 'committed' ||
         status === 'failed:logic' ||
         status === 'failed:internal' ||
         status === 'crashed';
}

function isPaused(status: RunStatus): boolean {
  return status.startsWith('paused:');
}
```

### 5. Map Error Types to Run Status

```typescript
function classifyToRunStatus(error: ClassifiedError, phase: ConsumerPhase): RunStatus {
  switch (error.type) {
    case 'network':
    case 'rate_limit':
    case 'timeout':
      return 'paused:transient';

    case 'auth':
    case 'permission':
      return 'paused:approval';

    case 'logic':
    case 'validation':
    case 'script_error':
      return 'failed:logic';

    case 'internal':
      return 'failed:internal';

    default:
      return 'failed:logic';  // Default to repair-eligible
  }
}

// For mutation indeterminate
if (phase === 'mutating' && mutation.status === 'indeterminate') {
  return 'paused:reconciliation';
}
```

### 6. Update HandlerRunStore

```typescript
interface HandlerRun {
  id: string;
  script_run_id: string;
  workflow_id: string;
  handler_type: 'producer' | 'consumer';
  handler_name: string;

  phase: ConsumerPhase | ProducerPhase;  // Execution progress
  status: RunStatus;                      // Why paused/stopped

  prepare_result?: string;  // JSON
  input_state?: string;     // JSON
  output_state?: string;    // JSON

  error?: string;
  error_type?: string;

  start_timestamp: string;
  end_timestamp?: string;
  cost?: number;
  logs?: string;  // JSON array
}
```

## Migration Path

1. Add `status` column with default 'active'
2. Migrate existing data:
   - `phase='committed'` → `status='committed'`
   - `phase='failed'` → `status='failed:logic'`, `phase` = last execution phase
   - `phase='suspended'` → `status='paused:reconciliation'`, `phase` = last execution phase
3. Update state machine code
4. Update queries that check for terminal state

## Testing

- Test that phase only moves forward through prepare→commit sequence
- Test that failures change status but not phase
- Test that paused runs can be resumed from same phase
- Test proper classification of different error types
- Test restart recovery correctly identifies crashed runs

## References

- docs/dev/06b-consumer-lifecycle.md - Run Lifecycle section
- docs/dev/16-scheduling.md - Run Status section
