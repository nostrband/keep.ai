# exec-06: Handler State Machine

## Goal

Implement unified state machine for handler execution. Same code handles normal execution and restart recovery.

## Core Loop

```typescript
async function executeHandler(handlerRunId: string): Promise<HandlerResult> {
  while (true) {
    // Always read fresh state from DB
    const run = await handlerRunStore.get(handlerRunId);

    if (isTerminal(run.phase)) {
      return { phase: run.phase, error: run.error };
    }

    // Handle current phase, updates DB, then loop continues
    await handlePhase(run);
  }
}

function isTerminal(phase: string): boolean {
  return ['committed', 'suspended', 'failed'].includes(phase);
}
```

## Producer State Machine

States: `pending → executing → committed | failed`

```typescript
const producerPhaseHandlers = {
  pending: async (run: HandlerRun) => {
    await handlerRunStore.updatePhase(run.id, 'executing');
  },

  executing: async (run: HandlerRun) => {
    const workflow = await workflowStore.get(run.workflow_id);
    const prevState = await handlerStateStore.get(workflow.id, run.handler_name);

    try {
      sandboxApi.setPhase('producer');
      sandbox.setGlobal('__state__', prevState);

      const newState = await sandbox.eval(`
${workflow.script.code}

return await workflow.producers.${run.handler_name}.handler(__state__);
`);

      // Atomic: events + state + phase='committed'
      await commitProducer(run, newState);
    } catch (error) {
      await failRun(run, classifyError(error));
    }
  },
};
```

## Consumer State Machine

States:
```
pending → preparing → prepared → mutating → mutated → emitting → committed
                   ↘ failed                       ↘ suspended    ↘ failed
                                                  ↘ failed
```

```typescript
const consumerPhaseHandlers = {
  pending: async (run: HandlerRun) => {
    await handlerRunStore.updatePhase(run.id, 'preparing');
  },

  preparing: async (run: HandlerRun) => {
    const workflow = await workflowStore.get(run.workflow_id);
    const prevState = await handlerStateStore.get(workflow.id, run.handler_name);

    try {
      sandboxApi.setPhase('prepare');
      sandbox.setGlobal('__state__', prevState);

      const prepareResult = await sandbox.eval(`
${workflow.script.code}

return await workflow.consumers.${run.handler_name}.prepare(__state__);
`);

      // Atomic: save result + reserve events + phase='prepared'
      await savePrepareAndReserve(run, prepareResult);
    } catch (error) {
      await failRun(run, classifyError(error));
    }
  },

  prepared: async (run: HandlerRun) => {
    const prepareResult = JSON.parse(run.prepare_result);

    if (prepareResult.reservations.length === 0) {
      // Nothing to process, skip to committed
      await commitConsumer(run, null);
    } else {
      await handlerRunStore.updatePhase(run.id, 'mutating');
    }
  },

  mutating: async (run: HandlerRun) => {
    const mutation = await mutationStore.getByHandlerRunId(run.id);

    if (!mutation || mutation.status === 'pending') {
      // Not started yet, execute mutate handler
      await executeMutate(run);
    } else if (mutation.status === 'in_flight') {
      // Crashed mid-mutation → indeterminate (no reconciliation)
      await mutationStore.update(mutation.id, { status: 'indeterminate' });
      await suspendRun(run, 'indeterminate_mutation');
    } else if (mutation.status === 'applied') {
      await handlerRunStore.updatePhase(run.id, 'mutated');
    } else if (mutation.status === 'indeterminate') {
      await suspendRun(run, 'indeterminate_mutation');
    } else if (mutation.status === 'failed') {
      await failRun(run, mutation.error);
    }
  },

  mutated: async (run: HandlerRun) => {
    await handlerRunStore.updatePhase(run.id, 'emitting');
  },

  emitting: async (run: HandlerRun) => {
    const workflow = await workflowStore.get(run.workflow_id);
    const config = JSON.parse(workflow.handler_config);

    // Skip if no next handler
    if (!config.consumers[run.handler_name].hasNext) {
      await commitConsumer(run, null);
      return;
    }

    const prepareResult = JSON.parse(run.prepare_result);
    const mutation = await mutationStore.getByHandlerRunId(run.id);
    const mutationResult = mutation
      ? { status: mutation.status, result: JSON.parse(mutation.result || 'null') }
      : { status: 'none' };

    try {
      sandboxApi.setPhase('next');
      sandbox.setGlobal('__prepared__', prepareResult);
      sandbox.setGlobal('__mutationResult__', mutationResult);

      const newState = await sandbox.eval(`
${workflow.script.code}

return await workflow.consumers.${run.handler_name}.next(__prepared__, __mutationResult__);
`);

      // Atomic: consume events + downstream events + state + phase='committed'
      await commitConsumer(run, newState);
    } catch (error) {
      await failRun(run, classifyError(error));
    }
  },
};
```

## Mutation Execution

Called from `mutating` phase when no mutation exists:

```typescript
async function executeMutate(run: HandlerRun): Promise<void> {
  const workflow = await workflowStore.get(run.workflow_id);
  const config = JSON.parse(workflow.handler_config);

  // Skip if no mutate handler
  if (!config.consumers[run.handler_name].hasMutate) {
    await handlerRunStore.updatePhase(run.id, 'mutated');
    return;
  }

  const prepareResult = JSON.parse(run.prepare_result);

  // Create mutation record BEFORE executing
  const mutation = await mutationStore.create({
    handlerRunId: run.id,
    workflowId: run.workflow_id,
    status: 'pending',
  });

  sandboxApi.setCurrentMutation(mutation);
  sandboxApi.setPhase('mutate');
  sandbox.setGlobal('__prepared__', prepareResult);

  try {
    await sandbox.eval(`
${workflow.script.code}

return await workflow.consumers.${run.handler_name}.mutate(__prepared__);
`);

    // If mutation was executed, mark applied
    const updatedMutation = await mutationStore.get(mutation.id);
    if (updatedMutation.status === 'in_flight') {
      await mutationStore.update(mutation.id, { status: 'applied' });
    }
    // State machine will read mutation status and transition

  } catch (error) {
    const updatedMutation = await mutationStore.get(mutation.id);
    if (isDefiniteFailure(error)) {
      await mutationStore.update(mutation.id, { status: 'failed', error: error.message });
    } else if (updatedMutation.status === 'in_flight') {
      // Uncertain outcome
      await mutationStore.update(mutation.id, { status: 'indeterminate', error: error.message });
    }
    // State machine will read mutation status and transition
  }
}
```

## Helper Functions

```typescript
async function failRun(run: HandlerRun, error: ClassifiedError): Promise<void> {
  await handlerRunStore.update(run.id, {
    phase: 'failed',
    error: error.message,
    error_type: error.type,
    end_timestamp: new Date().toISOString(),
  });
}

async function suspendRun(run: HandlerRun, reason: string): Promise<void> {
  await handlerRunStore.update(run.id, {
    phase: 'suspended',
    error: reason,
    end_timestamp: new Date().toISOString(),
  });
}

async function savePrepareAndReserve(run: HandlerRun, prepareResult: PrepareResult): Promise<void> {
  await db.transaction(async (tx) => {
    // Save prepare result
    await handlerRunStore.update(run.id, {
      prepare_result: JSON.stringify(prepareResult),
      phase: 'prepared',
    }, tx);

    // Reserve events
    for (const reservation of prepareResult.reservations) {
      await eventStore.reserveEvents(run.id, reservation.topic, reservation.ids, tx);
    }
  });
}

async function commitProducer(run: HandlerRun, newState: any): Promise<void> {
  await db.transaction(async (tx) => {
    // Update handler state
    if (newState !== undefined) {
      await handlerStateStore.set(run.workflow_id, run.handler_name, newState, run.id, tx);
    }

    // Mark run committed
    await handlerRunStore.update(run.id, {
      phase: 'committed',
      output_state: JSON.stringify(newState),
      end_timestamp: new Date().toISOString(),
    }, tx);

    // Update session handler count
    await scriptRunStore.incrementHandlerCount(run.script_run_id, tx);
  });
}

async function commitConsumer(run: HandlerRun, newState: any): Promise<void> {
  await db.transaction(async (tx) => {
    const prepareResult = run.prepare_result ? JSON.parse(run.prepare_result) : { reservations: [] };

    // Consume reserved events
    await eventStore.consumeEvents(run.id, tx);

    // Update handler state
    if (newState !== undefined) {
      await handlerStateStore.set(run.workflow_id, run.handler_name, newState, run.id, tx);
    }

    // Mark run committed
    await handlerRunStore.update(run.id, {
      phase: 'committed',
      output_state: JSON.stringify(newState),
      end_timestamp: new Date().toISOString(),
    }, tx);

    // Update session handler count
    await scriptRunStore.incrementHandlerCount(run.script_run_id, tx);
  });
}
```

## Testing

- Test producer: pending → executing → committed
- Test producer: executing → failed on error
- Test consumer: full happy path through all phases
- Test consumer: preparing → failed on error
- Test consumer: empty reservations → committed (skip mutate/next)
- Test consumer: mutating with in_flight mutation → suspended
- Test consumer: mutating with applied mutation → mutated
- Test restart: incomplete run continues from DB state
