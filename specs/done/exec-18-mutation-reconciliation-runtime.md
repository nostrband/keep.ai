# exec-18: Mutation Reconciliation Runtime

## Status: Ready for Implementation

## Summary

Implement the mutation reconciliation runtime as specified in `docs/dev/13-reconciliation.md`. The database infrastructure exists but the runtime logic is missing.

## Current State

### What's Already Implemented ✅

1. **Mutation Store** (`packages/db/src/mutation-store.ts`):
   - Status tracking: pending, in_flight, applied, failed, needs_reconcile, indeterminate
   - Fields: reconcile_attempts, next_reconcile_at, resolved_by, resolved_at
   - Methods: markInFlight(), markApplied(), markFailed(), markIndeterminate(), markNeedsReconcile()

2. **Indeterminate Resolution UI** (`packages/agent/src/indeterminate-resolution.ts`):
   - User resolution actions: happened, did_not_happen, skip
   - Proper state transitions for each resolution type

3. **Handler State Machine** (`packages/agent/src/handler-state-machine.ts`):
   - Consumer phases: preparing → prepared → mutating → mutated → emitting → committed
   - Status: paused:reconciliation for indeterminate mutations

### What's Missing ❌

1. **Immediate Reconciliation** (§13.7.2):
   - When mutation returns timeout/ambiguous error, should immediately try `reconcile()`
   - Currently: Any uncertain outcome → indeterminate immediately

2. **Connector Reconcile Methods** (§13.6.2):
   - Tools should provide `reconcile(mutation_params) -> { result?, status }`
   - Status: applied | failed | retry
   - Currently: No connector implements reconcile()

3. **Background Reconciliation Loop** (§13.7.4):
   - While in `needs_reconcile`, host should retry with backoff
   - reconcile_attempts should be incremented
   - Currently: `needs_reconcile` state is never used

## Implementation Phases

### Phase 1: Connector Reconcile Interface

Add reconcile method interface to connector tool wrappers.

**File: `packages/agent/src/tools/tool-types.ts`** (new or extend existing)

```typescript
export interface ReconcileResult {
  status: 'applied' | 'failed' | 'retry';
  result?: unknown;  // Tool-specific result (e.g., message ID for email)
}

export interface MutatorTool {
  // Existing mutation method
  execute(params: unknown): Promise<unknown>;

  // New reconcile method (optional - if missing, uncertain → indeterminate immediately)
  reconcile?(mutationParams: unknown): Promise<ReconcileResult>;
}
```

### Phase 2: Gmail Connector Reconcile

Implement reconcile for Gmail send email operation.

**File: `packages/agent/src/tools/gmail.ts`**

Reconcile strategy for `send`:
- Mutation params include idempotency_key (e.g., in X-Keep-Idempotency header or body)
- Search sent folder for message matching idempotency key
- If found → `{ status: 'applied', result: messageId }`
- If not found → `{ status: 'failed' }`
- If search fails → `{ status: 'retry' }`

### Phase 3: Mutation Wrapper Updates

Update mutation execution to support immediate reconciliation.

**File: `packages/agent/src/handler-state-machine.ts`**

```typescript
// In executeMutate() after mutation call fails with uncertain outcome:

async function handleUncertainOutcome(
  api: KeepDbApi,
  mutation: Mutation,
  tool: MutatorTool,
  context: HandlerContext
): Promise<MutationOutcome> {
  // If no reconcile method → indeterminate immediately
  if (!tool.reconcile) {
    await api.mutationStore.markIndeterminate(mutation.id);
    return { status: 'indeterminate' };
  }

  // Immediate reconciliation attempt (§13.7.2)
  try {
    const reconcileResult = await tool.reconcile(mutation.params);

    switch (reconcileResult.status) {
      case 'applied':
        await api.mutationStore.markApplied(mutation.id, reconcileResult.result);
        return { status: 'applied', result: reconcileResult.result };

      case 'failed':
        await api.mutationStore.markFailed(mutation.id);
        return { status: 'failed' };

      case 'retry':
        // Hand off to background reconciliation
        await api.mutationStore.markNeedsReconcile(mutation.id);
        return { status: 'needs_reconcile' };
    }
  } catch (error) {
    // Reconciliation call itself failed → needs_reconcile
    await api.mutationStore.markNeedsReconcile(mutation.id);
    return { status: 'needs_reconcile' };
  }
}
```

### Phase 4: Background Reconciliation Job

Add reconciliation loop to workflow scheduler.

**File: `packages/agent/src/reconciliation-scheduler.ts`** (new)

```typescript
export class ReconciliationScheduler {
  private interval: NodeJS.Timer | null = null;
  private readonly checkIntervalMs = 10_000; // 10 seconds

  constructor(
    private readonly api: KeepDbApi,
    private readonly toolRegistry: ToolRegistry
  ) {}

  start(): void {
    this.interval = setInterval(() => this.checkReconciliation(), this.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkReconciliation(): Promise<void> {
    // Find mutations in needs_reconcile where next_reconcile_at <= now
    const mutations = await this.api.mutationStore.getDueForReconciliation();

    for (const mutation of mutations) {
      await this.reconcileMutation(mutation);
    }
  }

  private async reconcileMutation(mutation: Mutation): Promise<void> {
    const tool = this.toolRegistry.getMutator(mutation.tool_name);

    if (!tool?.reconcile) {
      // Tool no longer supports reconcile (shouldn't happen, but handle it)
      await this.api.mutationStore.markIndeterminate(mutation.id);
      return;
    }

    // Increment attempt counter
    await this.api.mutationStore.incrementReconcileAttempts(mutation.id);

    if (mutation.reconcile_attempts >= MAX_RECONCILE_ATTEMPTS) {
      // Exhausted attempts → indeterminate
      await this.api.mutationStore.markIndeterminate(mutation.id);
      await this.pauseWorkflow(mutation.workflow_id);
      return;
    }

    try {
      const result = await tool.reconcile(mutation.params);

      switch (result.status) {
        case 'applied':
          await this.api.mutationStore.markApplied(mutation.id, result.result);
          await this.resumeHandler(mutation);
          break;

        case 'failed':
          await this.api.mutationStore.markFailed(mutation.id);
          // Can re-execute mutate handler
          await this.reExecuteMutate(mutation);
          break;

        case 'retry':
          // Schedule next reconciliation with exponential backoff
          const nextAttemptMs = this.calculateBackoff(mutation.reconcile_attempts);
          await this.api.mutationStore.scheduleNextReconcile(mutation.id, nextAttemptMs);
          break;
      }
    } catch (error) {
      // Reconciliation call failed → schedule retry
      const nextAttemptMs = this.calculateBackoff(mutation.reconcile_attempts);
      await this.api.mutationStore.scheduleNextReconcile(mutation.id, nextAttemptMs);
    }
  }

  private calculateBackoff(attempts: number): number {
    // Exponential backoff: 10s, 20s, 40s, 80s, ... capped at 10 minutes
    const baseMs = 10_000;
    const maxMs = 10 * 60 * 1000;
    return Math.min(baseMs * Math.pow(2, attempts), maxMs);
  }
}
```

### Phase 5: MutationStore Extensions

Add missing methods to mutation store.

**File: `packages/db/src/mutation-store.ts`**

```typescript
async getDueForReconciliation(): Promise<Mutation[]> {
  const now = Date.now();
  return this.db.all<Mutation>(
    `SELECT * FROM mutations
     WHERE status = 'needs_reconcile'
     AND (next_reconcile_at IS NULL OR next_reconcile_at <= ?)`,
    [now]
  );
}

async incrementReconcileAttempts(id: string): Promise<void> {
  await this.db.run(
    `UPDATE mutations SET reconcile_attempts = reconcile_attempts + 1 WHERE id = ?`,
    [id]
  );
}

async scheduleNextReconcile(id: string, delayMs: number): Promise<void> {
  const nextAt = Date.now() + delayMs;
  await this.db.run(
    `UPDATE mutations SET next_reconcile_at = ? WHERE id = ?`,
    [nextAt, id]
  );
}
```

### Phase 6: Handler State Machine Integration

Update handler execution to properly handle needs_reconcile status.

**File: `packages/agent/src/handler-state-machine.ts`**

When mutation returns `needs_reconcile`:
1. Set run status to `paused:reconciliation`
2. Suspend session
3. ReconciliationScheduler will handle retry
4. On resolution (applied/failed), resume handler at appropriate phase

### Phase 7: Tests

**File: `packages/tests/src/reconciliation.test.ts`**

Test cases:
1. Mutation timeout → immediate reconcile → applied → proceed to next
2. Mutation timeout → immediate reconcile → failed → re-execute mutate
3. Mutation timeout → immediate reconcile → retry → needs_reconcile status
4. Background reconciliation loop processes due mutations
5. Reconciliation exhausted → indeterminate → pause workflow
6. User resolves indeterminate → workflow resumes
7. Tool without reconcile method → immediate indeterminate

## Policy Configuration

Per Chapter 15, these should be configurable:

```typescript
const RECONCILIATION_POLICY = {
  maxAttempts: 5,
  baseBackoffMs: 10_000,
  maxBackoffMs: 10 * 60 * 1000,  // 10 minutes
  immediateReconcileTimeout: 30_000,  // 30 seconds for immediate attempt
};
```

## Non-Goals

- Connector-specific reconciliation for all tools (start with Gmail only)
- User-facing reconciliation progress UI (use existing indeterminate UI)
- Parallel reconciliation (single-threaded for v1)

## Dependencies

- Database: Already has required schema (mutations table with reconcile fields)
- Handler state machine: Already has paused:reconciliation status
- Indeterminate resolution: Already handles user actions

## Success Criteria

1. Mutation timeout triggers immediate reconciliation attempt
2. needs_reconcile mutations are processed by background job
3. Reconciliation respects attempt limits and backoff
4. Exhausted reconciliation escalates to user
5. All existing tests pass
6. New tests cover reconciliation paths
