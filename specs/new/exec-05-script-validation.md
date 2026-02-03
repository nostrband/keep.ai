# exec-05: Script Validation

## Goal

Validate workflow script structure on save/fix. Extract handler config and reject malformed scripts immediately so LLM can fix them.

## Script Format

Scripts define a plain `workflow` object:

```javascript
const workflow = {
  topics: {
    "email.received": {},
    "row.created": {},
  },

  producers: {
    pollEmail: {
      schedule: { interval: "5m" },  // or { cron: "*/5 * * * *" }
      handler: async (state) => { ... }
    }
  },

  consumers: {
    processEmail: {
      subscribe: ["email.received"],
      prepare: async (state) => { ... },
      mutate: async (prepared) => { ... },  // optional
      next: async (prepared, mutationResult) => { ... }  // optional
    }
  }
};
```

## Validation Rules

### Structure Validation

1. `workflow` must be an object
2. At least one producer or consumer must exist
3. Each producer must have:
   - `schedule` object with `interval` (string) or `cron` (string)
   - `handler` function
4. Each consumer must have:
   - `subscribe` non-empty array of topic names
   - `prepare` function
   - `mutate` function (optional)
   - `next` function (optional)
5. All subscribed topics should be declared in `topics` (warning, not error)

### Extracted Config

```typescript
interface WorkflowConfig {
  topics: string[];
  producers: Record<string, {
    schedule: { interval?: string; cron?: string };
  }>;
  consumers: Record<string, {
    subscribe: string[];
    hasMutate: boolean;
    hasNext: boolean;
  }>;
}
```

## Implementation

### 1. Create Validation Function

In `packages/agent/src/workflow-validator.ts`:

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  config?: WorkflowConfig;
}

async function validateWorkflowScript(code: string): Promise<ValidationResult> {
  // Use zero-tool sandbox (tools throw if called)
  const sandbox = await createValidationSandbox();

  const extractCode = `
${code}

// Structure validation
if (typeof workflow !== 'object' || workflow === null) {
  throw new Error('Script must define a workflow object');
}

if (!workflow.producers && !workflow.consumers) {
  throw new Error('Workflow must have at least one producer or consumer');
}

// Validate producers
const producerConfig = {};
for (const [name, p] of Object.entries(workflow.producers || {})) {
  if (typeof p.handler !== 'function') {
    throw new Error(\`Producer '\${name}': handler must be a function\`);
  }
  if (!p.schedule || (!p.schedule.interval && !p.schedule.cron)) {
    throw new Error(\`Producer '\${name}': schedule with interval or cron required\`);
  }
  producerConfig[name] = { schedule: p.schedule };
}

// Validate consumers
const consumerConfig = {};
for (const [name, c] of Object.entries(workflow.consumers || {})) {
  if (!Array.isArray(c.subscribe) || c.subscribe.length === 0) {
    throw new Error(\`Consumer '\${name}': subscribe must be non-empty array\`);
  }
  if (typeof c.prepare !== 'function') {
    throw new Error(\`Consumer '\${name}': prepare must be a function\`);
  }
  if (c.mutate !== undefined && typeof c.mutate !== 'function') {
    throw new Error(\`Consumer '\${name}': mutate must be a function if provided\`);
  }
  if (c.next !== undefined && typeof c.next !== 'function') {
    throw new Error(\`Consumer '\${name}': next must be a function if provided\`);
  }
  consumerConfig[name] = {
    subscribe: c.subscribe,
    hasMutate: typeof c.mutate === 'function',
    hasNext: typeof c.next === 'function',
  };
}

// Return extracted config
return {
  topics: Object.keys(workflow.topics || {}),
  producers: producerConfig,
  consumers: consumerConfig,
};
`;

  try {
    const config = await sandbox.eval(extractCode, { timeoutMs: 5000 });
    return { valid: true, config };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
```

### 2. Create Zero-Tool Sandbox

Sandbox where all tools throw validation errors:

```typescript
async function createValidationSandbox(): Promise<Sandbox> {
  const sandbox = await initSandbox({ timeoutMs: 5000 });

  // Inject tool stubs that throw
  const toolStub = () => {
    throw new Error('Tool calls not allowed during validation');
  };

  sandbox.setGlobal('Gmail', new Proxy({}, { get: () => toolStub }));
  sandbox.setGlobal('Sheets', new Proxy({}, { get: () => toolStub }));
  sandbox.setGlobal('Topics', new Proxy({}, { get: () => toolStub }));
  // ... etc for all tool namespaces

  return sandbox;
}
```

### 3. Integrate with Save/Fix

In planner's save tool and maintainer's fix tool:

```typescript
// Before saving script
const validation = await validateWorkflowScript(code);
if (!validation.valid) {
  // Return error to LLM for fixing
  return {
    success: false,
    error: `Script validation failed: ${validation.error}`,
  };
}

// Save script and config
await scriptStore.save(script);
await workflowStore.updateHandlerConfig(workflowId, validation.config);
```

### 4. Store Config in Workflow

Update workflow when script is saved:

```typescript
// In WorkflowStore
async updateHandlerConfig(workflowId: string, config: WorkflowConfig): Promise<void> {
  await this.db.run(
    `UPDATE workflows SET handler_config = ? WHERE id = ?`,
    [JSON.stringify(config), workflowId]
  );
}
```

## Error Messages

Clear error messages for LLM to understand and fix:

- `"Script must define a workflow object"` - Missing `const workflow = {...}`
- `"Workflow must have at least one producer or consumer"` - Empty workflow
- `"Producer 'X': handler must be a function"` - Missing handler
- `"Producer 'X': schedule with interval or cron required"` - Missing schedule
- `"Consumer 'X': subscribe must be non-empty array"` - Missing subscriptions
- `"Consumer 'X': prepare must be a function"` - Missing prepare handler

## Testing

- Test valid script extracts correct config
- Test missing workflow object fails
- Test missing producer handler fails
- Test missing consumer prepare fails
- Test tool call during validation throws
- Test error messages are clear
