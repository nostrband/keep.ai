# exec-04: Phase Tracking in Sandbox

## Goal

Add phase tracking to ToolWrapper to enforce operation restrictions per execution phase. This replaces the old `activeItem`-based mutation enforcement.

**Note**: This spec builds on exec-03a which switches workers to use ToolWrapper. Phase tracking is added to ToolWrapper, not the deprecated ToolWrapper.

## Phase Types

```typescript
type ExecutionPhase = 'producer' | 'prepare' | 'mutate' | 'next' | null;
```

## Phase Restrictions

| Operation | Producer | prepare | mutate | next |
|-----------|----------|---------|--------|------|
| Topics.peek | ✗ | ✓ | ✗ | ✗ |
| Topics.publish | ✓ | ✗ | ✗ | ✓ |
| External read | ✓ | ✓ | ✗ | ✗ |
| External mutation | ✗ | ✗ | ✓ (one) | ✗ |

## Implementation

### 1. Add Phase State to ToolWrapper

In `packages/agent/src/sandbox/api.ts`:

```typescript
class ToolWrapper {
  private currentPhase: ExecutionPhase = null;
  private mutationExecuted: boolean = false;
  private currentMutation: Mutation | null = null;

  setPhase(phase: ExecutionPhase): void {
    this.currentPhase = phase;
    this.mutationExecuted = false;
    this.currentMutation = null;
  }

  getPhase(): ExecutionPhase {
    return this.currentPhase;
  }

  setCurrentMutation(mutation: Mutation): void {
    this.currentMutation = mutation;
  }

  getCurrentMutation(): Mutation | null {
    return this.currentMutation;
  }
}
```

### 2. Add Phase Check Method

```typescript
type OperationType = 'read' | 'mutate' | 'topic_peek' | 'topic_publish';

checkPhaseAllowed(operation: OperationType): void {
  const allowed: Record<ExecutionPhase, Record<OperationType, boolean>> = {
    producer: { read: true, mutate: false, topic_peek: false, topic_publish: true },
    prepare:  { read: true, mutate: false, topic_peek: true, topic_publish: false },
    mutate:   { read: false, mutate: true, topic_peek: false, topic_publish: false },
    next:     { read: false, mutate: false, topic_peek: false, topic_publish: true },
  };

  if (!this.currentPhase) {
    throw new LogicError(`Operation '${operation}' not allowed outside handler execution`);
  }

  if (!allowed[this.currentPhase][operation]) {
    throw new LogicError(`Operation '${operation}' not allowed in '${this.currentPhase}' phase`);
  }

  // Enforce single mutation per mutate phase
  if (operation === 'mutate') {
    if (this.mutationExecuted) {
      throw new LogicError('Only one mutation allowed per mutate phase');
    }
    this.mutationExecuted = true;
  }
}
```

### 3. Update Tool Wrapper

In tool wrapper, call phase check before execution:

```typescript
async wrapTool(tool: Tool) {
  return async (input: unknown) => {
    // Validate input
    const validatedInput = tool.inputSchema.parse(input);

    // Check phase restrictions
    if (tool.isReadOnly?.(validatedInput)) {
      this.checkPhaseAllowed('read');
    } else {
      this.checkPhaseAllowed('mutate');
    }

    // Execute tool
    return await tool.execute(validatedInput, this.context);
  };
}
```

### 4. Update Mutation Tools

For mutation tools (Gmail.send, Sheets.append, etc.), integrate with mutation ledger:

```typescript
// In mutation tool execution:
async executeMutation(namespace: string, method: string, params: any) {
  const mutation = this.sandboxApi.getCurrentMutation();
  if (!mutation) {
    throw new LogicError('Mutation called outside mutate phase');
  }

  // Record in ledger BEFORE external call
  await this.mutationStore.update(mutation.id, {
    status: 'in_flight',
    toolNamespace: namespace,
    toolMethod: method,
    params: JSON.stringify(params),
    idempotencyKey: generateIdempotencyKey(namespace, method, params),
  });

  // Execute external call
  const result = await this.executeExternalCall(namespace, method, params);

  // Store result
  await this.mutationStore.update(mutation.id, {
    result: JSON.stringify(result),
  });

  return result;
}
```

### 5. Remove Old Enforcement

Remove from ToolWrapper:
- `activeItem` property
- `activeItemIsDone` property
- `enforceMutationRestrictions()` method

## Global Injection

Before running a handler, inject inputs as globals:

```typescript
// In handler execution code:
sandbox.setGlobal('__state__', prevState);
sandbox.setGlobal('__prepared__', prepareResult);      // for mutate/next
sandbox.setGlobal('__mutationResult__', mutationResult); // for next
```

## Testing

- Test phase check throws LogicError for disallowed operations
- Test mutation in prepare phase throws
- Test read in mutate phase throws
- Test Topics.peek in producer throws
- Test Topics.publish in prepare throws
- Test second mutation in mutate phase throws
- Test null phase throws for all operations
