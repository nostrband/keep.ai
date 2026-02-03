# exec-07: Session Orchestration

## Goal

Implement session-based workflow execution using `script_runs` as the session container. A session runs producers, then loops consumers until work is done or budget is exhausted.

## Session Structure

```
script_run (session)
    ├── handler_run (producer: pollEmail)
    ├── handler_run (consumer: processEmail, event 1)
    ├── handler_run (consumer: processEmail, event 2)
    └── handler_run (consumer: processEmail, event 3)
```

## Session Execution

```typescript
async function executeWorkflowSession(
  workflow: Workflow,
  trigger: 'schedule' | 'manual' | 'event'
): Promise<SessionResult> {
  // Create session container
  const session = await scriptRunStore.create({
    workflowId: workflow.id,
    scriptId: workflow.active_script_id,
    trigger,
    startTimestamp: new Date().toISOString(),
  });

  try {
    // 1. Run producers (if scheduled/manual trigger)
    if (trigger === 'schedule' || trigger === 'manual') {
      const config = JSON.parse(workflow.handler_config);

      for (const producerName of Object.keys(config.producers)) {
        const handlerRun = await handlerRunStore.create({
          scriptRunId: session.id,
          workflowId: workflow.id,
          handlerType: 'producer',
          handlerName: producerName,
          phase: 'pending',
          startTimestamp: new Date().toISOString(),
        });

        const result = await executeHandler(handlerRun.id);

        if (result.phase === 'failed') {
          await failSession(session, result.error);
          return { status: 'failed', error: result.error };
        }
      }
    }

    // 2. Loop consumers while work exists (with budget)
    let iterations = 0;
    const maxIterations = 100;  // Configurable budget

    while (iterations < maxIterations) {
      const consumer = await findConsumerWithPendingWork(workflow);
      if (!consumer) break;  // No more work

      const handlerRun = await handlerRunStore.create({
        scriptRunId: session.id,
        workflowId: workflow.id,
        handlerType: 'consumer',
        handlerName: consumer.name,
        phase: 'pending',
        startTimestamp: new Date().toISOString(),
      });

      const result = await executeHandler(handlerRun.id);
      iterations++;

      if (result.phase === 'suspended') {
        await suspendSession(session, 'handler_suspended');
        return { status: 'suspended', reason: 'handler_suspended' };
      }
      if (result.phase === 'failed') {
        await failSession(session, result.error);
        return { status: 'failed', error: result.error };
      }
      // committed with empty reservations = continue checking for more work
    }

    // 3. Complete session
    await completeSession(session);
    return { status: 'completed' };

  } catch (error) {
    await failSession(session, classifyError(error).message);
    return { status: 'failed', error: error.message };
  }
}
```

## Find Consumer With Pending Work

```typescript
async function findConsumerWithPendingWork(workflow: Workflow): Promise<{ name: string } | null> {
  const config = JSON.parse(workflow.handler_config);

  for (const [consumerName, consumerConfig] of Object.entries(config.consumers)) {
    // Check if any subscribed topic has pending events
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

## Session State Management

```typescript
async function completeSession(session: ScriptRun): Promise<void> {
  await scriptRunStore.update(session.id, {
    result: 'completed',
    endTimestamp: new Date().toISOString(),
  });
}

async function failSession(session: ScriptRun, error: string): Promise<void> {
  await scriptRunStore.update(session.id, {
    result: 'failed',
    error,
    endTimestamp: new Date().toISOString(),
  });

  // Pause workflow on failure
  await workflowStore.update(session.workflow_id, { status: 'error' });
}

async function suspendSession(session: ScriptRun, reason: string): Promise<void> {
  await scriptRunStore.update(session.id, {
    result: 'suspended',
    error: reason,
    endTimestamp: new Date().toISOString(),
  });

  // Pause workflow on suspension
  await workflowStore.update(session.workflow_id, { status: 'paused' });
}
```

## Restart Recovery

On app restart, resume incomplete sessions:

```typescript
async function resumeIncompleteSessions(): Promise<void> {
  // Find workflows with incomplete handler runs
  const workflowsWithIncomplete = await handlerRunStore.getWorkflowsWithIncompleteRuns();

  for (const workflowId of workflowsWithIncomplete) {
    const workflow = await workflowStore.get(workflowId);

    // Skip paused/error workflows
    if (workflow.status !== 'active') continue;

    // Resume incomplete handler runs sequentially
    const incompleteRuns = await handlerRunStore.getIncomplete(workflowId);
    for (const run of incompleteRuns) {
      await executeHandler(run.id);
    }

    // After resuming handlers, check if session should continue
    const session = await scriptRunStore.get(incompleteRuns[0]?.script_run_id);
    if (session && !session.end_timestamp) {
      // Session was interrupted, continue it
      await continueSession(workflow, session);
    }
  }
}

async function continueSession(workflow: Workflow, session: ScriptRun): Promise<void> {
  // Continue consumer loop from where we left off
  let iterations = session.handler_run_count || 0;
  const maxIterations = 100;

  while (iterations < maxIterations) {
    const consumer = await findConsumerWithPendingWork(workflow);
    if (!consumer) break;

    const handlerRun = await handlerRunStore.create({
      scriptRunId: session.id,
      workflowId: workflow.id,
      handlerType: 'consumer',
      handlerName: consumer.name,
      phase: 'pending',
      startTimestamp: new Date().toISOString(),
    });

    const result = await executeHandler(handlerRun.id);
    iterations++;

    if (result.phase === 'suspended' || result.phase === 'failed') {
      await (result.phase === 'suspended' ? suspendSession : failSession)(session, result.error);
      return;
    }
  }

  await completeSession(session);
}
```

## Scheduler Integration

Update scheduler to use session execution:

```typescript
// In workflow scheduler
async function onScheduleTrigger(workflow: Workflow): Promise<void> {
  // Check single-threaded constraint
  const hasActiveRun = await handlerRunStore.hasActiveRun(workflow.id);
  if (hasActiveRun) {
    // Skip this trigger, another run is active
    return;
  }

  await executeWorkflowSession(workflow, 'schedule');
}

async function onManualTrigger(workflow: Workflow): Promise<void> {
  const hasActiveRun = await handlerRunStore.hasActiveRun(workflow.id);
  if (hasActiveRun) {
    throw new Error('Another run is active');
  }

  await executeWorkflowSession(workflow, 'manual');
}
```

## Cost Aggregation

Session aggregates costs from handler runs:

```typescript
async function getSessionCost(sessionId: string): Promise<number> {
  const runs = await handlerRunStore.getBySession(sessionId);
  return runs.reduce((sum, run) => sum + (run.cost || 0), 0);
}

// Or compute on session complete:
async function completeSession(session: ScriptRun): Promise<void> {
  const totalCost = await getSessionCost(session.id);

  await scriptRunStore.update(session.id, {
    result: 'completed',
    cost: totalCost,
    endTimestamp: new Date().toISOString(),
  });
}
```

## Testing

- Test session creates handler runs in order
- Test session stops on handler failure
- Test session stops on handler suspension
- Test session completes when no more work
- Test budget limit stops session
- Test restart resumes incomplete runs
- Test single-threaded constraint enforced
- Test cost aggregation
