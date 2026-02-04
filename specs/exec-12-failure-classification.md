# exec-12: Failure Classification and Run Status Mapping

## Problem

The docs (09-failure-repair.md, 16-scheduling.md) define a closed taxonomy of failure types that map to specific run statuses and handling paths:

| Failure Type | Run Status | Handling |
|--------------|------------|----------|
| Transient (rate limit, timeout) | `paused:transient` | Backoff → new run |
| Logic error (script throws) | `failed:logic` | Auto-fix → new run |
| Auth failure (token expired) | `paused:approval` | User re-auths → resume |
| Permission denied | `paused:approval` | User grants → resume |
| Mutation indeterminate | `paused:reconciliation` | User verifies → resume |
| Internal error (our bug) | `failed:internal` | Contact support |

The error classification system exists (`@app/proto/src/errors.ts`) but:
- Mapping from `ErrorType` to `RunStatus` is not implemented
- State machine doesn't use run statuses from the classification
- `classifyGenericError` falls back to pattern matching (unreliable)

## Principle

**Errors must be classified at the source, not at consumption.**

| Layer | Responsibility |
|-------|----------------|
| **Connectors** | Throw `ClassifiedError` with correct type (AuthError, NetworkError, etc.) |
| **ToolWrapper** | Throw `ClassifiedError` for phase violations, workflow paused |
| **Sandbox** | Any unclassified exception from `sandbox.eval` → `LogicError` |
| **State machine** | Map `error.type` to `RunStatus`, never pattern-match |

## Solution

### 1. Existing Error Types (from @app/proto)

```typescript
type ErrorType = 'auth' | 'permission' | 'network' | 'logic' | 'internal';

// Already defined:
class AuthError extends ClassifiedError { type = 'auth' }
class PermissionError extends ClassifiedError { type = 'permission' }
class NetworkError extends ClassifiedError { type = 'network' }
class LogicError extends ClassifiedError { type = 'logic' }
class InternalError extends ClassifiedError { type = 'internal' }
```

### 2. Map ErrorType to RunStatus

Add mapping function (NOT pattern matching):

```typescript
// In packages/agent/src/failure-handling.ts

import { ClassifiedError, ErrorType, isClassifiedError, LogicError } from '@app/proto';

/**
 * Map ClassifiedError type to RunStatus.
 * This is a simple lookup, NOT pattern matching.
 */
function errorTypeToRunStatus(errorType: ErrorType): RunStatus {
  const mapping: Record<ErrorType, RunStatus> = {
    'auth': 'paused:approval',
    'permission': 'paused:approval',
    'network': 'paused:transient',
    'logic': 'failed:logic',
    'internal': 'failed:internal',
  };
  return mapping[errorType];
}

/**
 * Classify error and get run status.
 * - If already ClassifiedError, use its type
 * - Otherwise, it's an InternalError (connector/wrapper bug)
 *
 * STRICT POLICY: No pattern matching. If something throws an unclassified
 * error, that's a bug in our code (connector or wrapper), not a script bug.
 */
function getRunStatusForError(error: unknown): { status: RunStatus; error: ClassifiedError } {
  if (isClassifiedError(error)) {
    return {
      status: errorTypeToRunStatus(error.type),
      error,
    };
  }

  // Unclassified error = internal bug (connector/wrapper misbehaving)
  const internalError = new InternalError(
    `Unclassified error from internal code: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error instanceof Error ? error : undefined }
  );

  return {
    status: 'failed:internal',
    error: internalError,
  };
}
```

### 3. Connectors Must Throw ClassifiedError

**Already implemented** for Google APIs and Notion. Verify all connectors follow this pattern:

```typescript
// In connector code (e.g., gmail.ts)
try {
  const response = await gmail.users.messages.send(...);
  return response.data;
} catch (err) {
  // Use connector-specific classifier
  throw classifyGoogleApiError(err, 'Gmail.send');
}
```

Connectors should NOT throw raw errors. If a connector throws an unclassified error, that's a bug in the connector (internal error).

### 4. ToolWrapper Throws ClassifiedError

**Already implemented** for:
- Phase violations → `LogicError`
- Workflow paused → `WorkflowPausedError` (special, not classified)

Verify ToolWrapper uses ClassifiedError:

```typescript
// In tool-wrapper.ts
checkPhaseAllowed(operation: OperationType): void {
  if (!allowed[this.currentPhase][operation]) {
    throw new LogicError(
      `Operation '${operation}' not allowed in '${this.currentPhase}' phase`,
      { source: 'ToolWrapper' }
    );
  }
}
```

### 5. Update State Machine Error Handling

```typescript
// In handler-state-machine.ts

async function handlePreparing(run: HandlerRun): Promise<void> {
  try {
    // ... execute prepare ...
  } catch (error) {
    // Get run status from error type (no pattern matching!)
    const { status, error: classified } = getRunStatusForError(error);

    await handlerRunStore.update(run.id, {
      status,
      error: classified.message,
      error_type: classified.type,
      end_timestamp: new Date().toISOString(),
    });

    // Route to appropriate handler based on status
    await routeFailure(run, status, classified);
  }
}
```

### 6. Failure Routing

```typescript
async function routeFailure(
  run: HandlerRun,
  status: RunStatus,
  error: ClassifiedError
): Promise<void> {
  switch (status) {
    case 'paused:transient':
      // Network error - schedule retry with backoff
      await scheduleRetry(run, error);
      break;

    case 'paused:approval':
      // Auth/permission - pause workflow, notify user
      await pauseForUserAction(run, error);
      break;

    case 'failed:logic':
      // Script bug - trigger auto-fix
      await triggerAutoFix(run, error);
      break;

    case 'failed:internal':
      // Our bug - pause workflow, alert support
      await pauseForInternal(run, error);
      break;
  }
}
```

### 7. Handling Paths

```typescript
async function scheduleRetry(run: HandlerRun, error: ClassifiedError): Promise<void> {
  const retryCount = await getRetryCount(run.id);
  const maxRetries = 5;  // From host policy

  if (retryCount >= maxRetries) {
    // Escalate after max retries
    await escalateToUser(run, error, 'Max retries exceeded');
    return;
  }

  const backoffMs = calculateBackoff(retryCount);

  // Schedule retry - when backoff expires, scheduler will call
  // createRetryRun() from exec-10 to create the new run
  await scheduler.scheduleRetry({
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    retryAt: Date.now() + backoffMs,
  });
}

async function triggerAutoFix(run: HandlerRun, error: ClassifiedError): Promise<void> {
  const budget = await getRepairBudget(run.workflow_id);

  if (budget.attemptsRemaining <= 0) {
    await escalateToUser(run, error, 'Repair budget exhausted');
    return;
  }

  await taskQueue.enqueue({
    type: 'maintainer',
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    error: error.toJSON(),
  });
}

async function pauseForUserAction(run: HandlerRun, error: ClassifiedError): Promise<void> {
  await workflowStore.update(run.workflow_id, { status: 'paused' });

  await escalationStore.create({
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    errorType: error.type,
    message: error.message,
    source: error.source,
    createdAt: new Date().toISOString(),
  });
}

async function pauseForInternal(run: HandlerRun, error: ClassifiedError): Promise<void> {
  await workflowStore.update(run.workflow_id, { status: 'error' });

  // Log for support investigation
  console.error('Internal error in workflow', {
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    error: error.toJSON(),
  });

  await escalationStore.create({
    workflowId: run.workflow_id,
    handlerRunId: run.id,
    errorType: 'internal',
    message: 'Internal error. Please contact support.',
    createdAt: new Date().toISOString(),
  });
}
```

### 8. Backoff Calculation

```typescript
function calculateBackoff(retryCount: number): number {
  // Exponential backoff with jitter
  const baseMs = 1000;  // 1 second
  const maxMs = 5 * 60 * 1000;  // 5 minutes

  const exponentialMs = Math.min(baseMs * Math.pow(2, retryCount), maxMs);
  const jitter = Math.random() * 0.3 * exponentialMs;  // 0-30% jitter

  return Math.floor(exponentialMs + jitter);
}
```

### 9. Special Case: Mutation Indeterminate

Mutation indeterminate is NOT an ErrorType - it's detected by mutation status:

```typescript
// In mutating phase handler
if (mutation.status === 'in_flight') {
  // Crashed during mutation - uncertain outcome
  await mutationStore.update(mutation.id, { status: 'indeterminate' });

  await handlerRunStore.update(run.id, {
    status: 'paused:reconciliation',
    error: 'Mutation outcome uncertain',
  });

  await pauseForReconciliation(run);
  return;
}
```

This is separate from error classification - it's a state machine transition.

## What NOT to Do

**DO NOT pattern-match on error messages:**

```typescript
// BAD - unreliable, will break
function isAuthError(error: Error): boolean {
  return /unauthorized|401|token expired/i.test(error.message);
}

// GOOD - explicit type
function isAuthError(error: unknown): boolean {
  return isClassifiedError(error) && error.type === 'auth';
}
```

**DO NOT use `ensureClassified` or `classifyGenericError`:**

```typescript
// BAD - pattern matching fallback
const classified = ensureClassified(error);  // Uses classifyGenericError internally

// BAD - pattern matching
throw classifyGenericError(error, "MyTool");

// GOOD - treat unclassified as internal error
const classified = isClassifiedError(error)
  ? error
  : new InternalError(`Unclassified error: ${error.message}`);
```

**DO NOT default unclassified errors to LogicError:**

```typescript
// BAD - hides bugs in our code
const classified = isClassifiedError(error) ? error : new LogicError(error.message);

// GOOD - unclassified = bug in connector/wrapper
const classified = isClassifiedError(error) ? error : new InternalError(error.message);
```

If a connector or tool throws an unclassified error, that's a bug in our code that needs fixing, not a script bug that auto-fix should handle.

## Migration: Remove Pattern Matching

### Files to Update

**handler-state-machine.ts** - Replace `ensureClassified` calls:
```typescript
// BEFORE
const classifiedError = ensureClassified(error, "producer.handler");

// AFTER
const classifiedError = isClassifiedError(error)
  ? error
  : new InternalError(`Unclassified error in producer.handler: ${error.message}`);
```

**session-orchestration.ts** - Same pattern.

**All tools using `classifyGenericError`** - Must throw proper ClassifiedError:
```typescript
// BEFORE (in text-generate.ts, images-explain.ts, etc.)
throw classifyGenericError(error instanceof Error ? error : new Error(String(error)), "Text.generate");

// AFTER - classify explicitly based on known error types
if (error.response?.status) {
  throw classifyHttpError(error.response.status, error.message, { source: "Text.generate" });
}
throw new InternalError(`Unexpected error in Text.generate: ${error.message}`, { cause: error });
```

### Deprecate Pattern Matching Functions

In `@app/proto/src/errors.ts`:
```typescript
/**
 * @deprecated Do not use. Connectors must throw ClassifiedError explicitly.
 * Unclassified errors should be treated as InternalError.
 */
export function classifyGenericError(...) { ... }

/**
 * @deprecated Do not use. Check isClassifiedError and treat unclassified as InternalError.
 */
export function ensureClassified(...) { ... }
```

## Verification Checklist

- [ ] All connectors throw ClassifiedError (AuthError, NetworkError, etc.)
- [ ] ToolWrapper throws LogicError for phase violations
- [ ] State machine uses `errorTypeToRunStatus`, not pattern matching
- [ ] Unclassified errors become InternalError (not LogicError)
- [ ] Mutation indeterminate handled separately (not via ErrorType)
- [ ] Remove all `ensureClassified` calls from handler-state-machine.ts
- [ ] Remove all `ensureClassified` calls from session-orchestration.ts
- [ ] Remove all `classifyGenericError` calls from tools
- [ ] Deprecate `ensureClassified` and `classifyGenericError` in @app/proto

## Testing

- Test AuthError from connector → `paused:approval`
- Test NetworkError from connector → `paused:transient`
- Test LogicError (phase violation) → `failed:logic`
- Test unclassified Error → `failed:internal` (bug in our code)
- Test InternalError → `failed:internal`
- Test retry count exhaustion → escalate
- Test repair budget exhaustion → escalate
- Test all tools throw ClassifiedError (no unclassified leaking through)

## References

- packages/proto/src/errors.ts - Error classification system
- docs/dev/09-failure-repair.md - Failure taxonomy
- docs/dev/16-scheduling.md - Run status mapping
