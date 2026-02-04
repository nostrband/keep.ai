# exec-14: Indeterminate Mutation Handling (Without Reconciliation)

## Problem

The docs (Chapter 13, Chapter 16) define reconciliation logic for uncertain mutation outcomes. However, per the user's note:

> We explicitly don't implement 'reconciliation' chapter yet, thus any uncertain failure in mutation immediately marks it as indeterminate

This spec defines how to handle indeterminate mutations WITHOUT auto-reconciliation.

## Key Principle

From doc 09-failure-repair.md:
> If reconciliation cannot deterministically establish outcome, the mutation is marked indeterminate and escalated.

Since we're not implementing reconciliation, ALL uncertain outcomes immediately become indeterminate and escalate.

## What Causes Indeterminate State

| Scenario | Description |
|----------|-------------|
| Crash during mutation | Host crashes while mutation is `in_flight` |
| Timeout after request sent | HTTP request sent but response never received |
| Ambiguous error | Error that doesn't clearly indicate success or failure |

## Solution

### 1. Mutation Status Flow (Simplified)

```
pending → in_flight → applied     (success)
                   → failed       (definite failure)
                   → indeterminate (uncertain - needs user)
```

**No `needs_reconcile` status** - we go directly to `indeterminate` for any uncertain outcome.

### 2. Detect Indeterminate State

```typescript
function isDefiniteFailure(error: Error): boolean {
  // Errors that definitively mean mutation did NOT happen
  const definiteFailurePatterns = [
    /4\d\d/,           // 4xx client errors (request rejected)
    /validation/i,      // Input validation failed
    /invalid.*input/i,
    /bad request/i,
    /not found/i,       // Target resource doesn't exist
    /already exists/i,  // Constraint violation before mutation
  ];

  return definiteFailurePatterns.some(p => p.test(error.message));
}

function classifyMutationOutcome(error: Error | null, mutation: Mutation): MutationStatus {
  if (!error) {
    return 'applied';
  }

  if (mutation.status !== 'in_flight') {
    // Mutation hadn't started yet
    return 'failed';
  }

  // Mutation was in_flight when error occurred
  if (isDefiniteFailure(error)) {
    return 'failed';
  }

  // Uncertain - could have succeeded or failed
  return 'indeterminate';
}
```

### 3. Handle In-Flight on Restart

From doc 16-scheduling.md:
> If mutation applied but outcome uncertain → enter reconciliation

Since we don't have reconciliation:

```typescript
async function recoverMutationsOnRestart(): Promise<void> {
  // Find mutations left in_flight when host crashed
  const inFlightMutations = await mutationStore.findByStatus('in_flight');

  for (const mutation of inFlightMutations) {
    // Without reconciliation, all in_flight mutations are indeterminate
    await mutationStore.update(mutation.id, {
      status: 'indeterminate',
      error: 'Host crashed during mutation execution. Outcome uncertain.',
    });

    // Update the handler run
    const run = await handlerRunStore.get(mutation.handler_run_id);
    if (run) {
      await handlerRunStore.update(run.id, {
        status: 'paused:reconciliation',
        error: 'Mutation outcome uncertain. Please verify and resolve.',
      });
    }
  }
}
```

### 4. User Resolution Options

When mutation is indeterminate, user has these options:

| Action | Meaning | Effect |
|--------|---------|--------|
| "It happened" | User verified mutation succeeded | Mark as applied, continue to next |
| "It didn't happen" | User verified mutation failed | Mark as failed, allow retry |
| "Skip" | User doesn't want to retry | Mark events as skipped, commit |

```typescript
async function resolveIndeterminateMutation(
  mutationId: string,
  resolution: 'happened' | 'did_not_happen' | 'skip'
): Promise<void> {
  const mutation = await mutationStore.get(mutationId);
  if (mutation.status !== 'indeterminate') {
    throw new Error('Mutation is not indeterminate');
  }

  const run = await handlerRunStore.get(mutation.handler_run_id);

  switch (resolution) {
    case 'happened':
      // User confirms mutation succeeded
      await mutationStore.update(mutationId, {
        status: 'applied',
        resolved_by: 'user_assert_applied',
        resolved_at: Date.now(),
      });

      // Continue to next phase
      await handlerRunStore.update(run.id, {
        phase: 'mutated',
        status: 'active',
      });

      // Resume execution
      await executeHandler(run.id);
      break;

    case 'did_not_happen':
      // User confirms mutation failed
      await mutationStore.update(mutationId, {
        status: 'failed',
        resolved_by: 'user_assert_failed',
        resolved_at: Date.now(),
      });

      // Create retry run (will re-execute mutate)
      await createRetryRun({
        previousRun: run,
        reason: 'user_retry',
      });

      // Resume workflow
      await workflowStore.update(run.workflow_id, { status: 'active' });
      break;

    case 'skip':
      // User wants to skip this event
      await mutationStore.update(mutationId, {
        status: 'failed',  // Treat as failed
        resolved_by: 'user_skip',
        resolved_at: Date.now(),
      });

      // Skip reserved events
      await eventStore.skipEvents(run.id);

      // Mark run as committed (with skip)
      await handlerRunStore.update(run.id, {
        phase: 'committed',
        status: 'committed',
      });

      // Resume workflow
      await workflowStore.update(run.workflow_id, { status: 'active' });
      break;
  }
}
```

### 5. Mutation Result in next Phase

When user resolves indeterminate as "happened" or "skip", the `next` phase receives appropriate result:

```typescript
function getMutationResultForNext(mutation: Mutation): MutationResult {
  switch (mutation.status) {
    case 'applied':
      return {
        status: 'applied',
        result: JSON.parse(mutation.result || 'null'),
      };

    case 'failed':
      if (mutation.resolved_by === 'user_skip') {
        return { status: 'skipped' };
      }
      // If failed and not skipped, run shouldn't reach next
      throw new Error('Unexpected: failed mutation in next phase');

    default:
      return { status: 'none' };
  }
}
```

### 6. Workflow Status During Indeterminate

From doc 16-scheduling.md:
> `paused:reconciliation` | Uncertain mutation outcome | Reconciliation or user action

```typescript
async function handleIndeterminateMutation(run: HandlerRun, mutation: Mutation): Promise<void> {
  // Mark mutation as indeterminate
  await mutationStore.update(mutation.id, {
    status: 'indeterminate',
  });

  // Mark run as paused for reconciliation
  await handlerRunStore.update(run.id, {
    status: 'paused:reconciliation',
    error: 'Mutation outcome uncertain. Manual verification required.',
  });

  // Pause workflow
  await workflowStore.update(run.workflow_id, {
    status: 'paused',
  });

  // Create escalation for user
  await escalationStore.create({
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    mutationId: mutation.id,
    type: 'indeterminate_mutation',
    message: `Uncertain if "${mutation.tool_method}" completed. Please verify in ${mutation.tool_namespace}.`,
    createdAt: new Date().toISOString(),
  });
}
```

### 7. UI Guidance

The escalation should include:
- Which tool/method was called
- What parameters were used
- Where to check in external system
- User's options (happened/didn't happen/skip)

```typescript
interface IndeterminateEscalation {
  type: 'indeterminate_mutation';
  message: string;
  details: {
    tool: string;
    method: string;
    params: Record<string, unknown>;
    checkInstructions: string;  // "Check your Gmail sent folder for..."
  };
  actions: [
    { id: 'happened', label: 'It happened', description: 'I verified the action completed' },
    { id: 'did_not_happen', label: "It didn't happen", description: 'I verified the action did not complete' },
    { id: 'skip', label: 'Skip this event', description: 'Skip processing and continue with other events' },
  ];
}
```

## When Reconciliation IS Implemented Later

This spec is designed to be forward-compatible. When Chapter 13 is implemented:

1. Add `needs_reconcile` status between `in_flight` and `indeterminate`
2. Add auto-reconciliation logic that checks external system
3. Only escalate to user if auto-reconciliation fails
4. User resolution logic remains the same

## Database Changes

None required - uses existing columns:
- `mutations.status` includes 'indeterminate'
- `mutations.resolved_by` and `resolved_at` exist

## Testing

- Test timeout during mutation → indeterminate
- Test crash during in_flight → indeterminate on restart
- Test user "happened" resolution → continues to next
- Test user "didn't happen" resolution → creates retry run
- Test user "skip" resolution → events skipped, run committed
- Test workflow paused during indeterminate
- Test definite failures don't become indeterminate

## References

- docs/dev/13-reconciliation.md (NOT implemented, but referenced)
- docs/dev/16-scheduling.md - Mutation indeterminate handling
- docs/dev/09-failure-repair.md - Indeterminate side-effect outcomes
