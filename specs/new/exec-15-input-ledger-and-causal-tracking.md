# exec-15: Input Ledger, Causal Tracking, and Topic Declarations

## Problem

The execution model docs (06a-topics-and-handlers.md, 06b-consumer-lifecycle.md) were updated to introduce:

1. **Input Ledger** — a separate table tracking external inputs with user-facing metadata (source, type, id, title)
2. **Causal tracking** — events carry `caused_by` (array of Input IDs) linking back to originating inputs
3. **Producer `publishes` declarations** — producers must declare which topics they publish to
4. **Consumer `publishes` declarations** — consumers must declare which topics they emit to in `next`
5. **`ctx.registerInput()`** — producers must register inputs before publishing events
6. **Event title removal** — events no longer have `title`; user-facing metadata lives in the Input Ledger
7. **Multi-topic publish** — `ctx.publish(["topicA", "topicB"], {...})`
8. **Structured `prepareResult.ui`** — `ui: { title: string }` instead of generic

The current implementation (exec-01 through exec-08) does not have any of these. This spec brings the implementation in line with the updated execution model.

## What This Spec Does NOT Cover

- Input Ledger UX (Chapter 17 — Inputs & Outputs view, skip semantics, pending rollup)
- Output/mutation ledger UX
- Stale input warnings
- Input status computation queries for the UI

Those are UX-layer concerns for a separate spec. This spec covers only the data model and runtime changes needed for the execution model to work correctly.

---

## 1. Database Changes

### 1a. New `inputs` table (Input Ledger)

```sql
CREATE TABLE inputs (
  id TEXT PRIMARY KEY,                -- host-generated inputId
  workflow_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- connector name: 'gmail', 'slack', 'sheets', etc.
  type TEXT NOT NULL,                 -- type within source: 'email', 'message', 'row', etc.
  external_id TEXT NOT NULL,          -- external identifier from source system
  title TEXT NOT NULL,                -- human-readable description
  created_by_run_id TEXT,             -- producer run that registered this input
  created_at INTEGER NOT NULL,
  UNIQUE(workflow_id, source, type, external_id)
);

CREATE INDEX idx_inputs_workflow ON inputs(workflow_id);

SELECT crsql_as_crr('inputs');
```

Uniqueness constraint enforces idempotent registration: same `(workflow_id, source, type, external_id)` returns the existing row.

### 1b. Alter `events` table

```sql
-- Add caused_by column (JSON array of input IDs)
ALTER TABLE events ADD COLUMN caused_by TEXT NOT NULL DEFAULT '[]';

-- Make title optional (no longer required by execution model)
-- SQLite doesn't support ALTER COLUMN, so we handle this in code:
-- - New events are created with title = '' (empty string)
-- - Existing events keep their titles (backward compatible)
-- - Code stops reading/writing title for new events
```

The `title` column remains in the schema for backward compatibility with existing data but is no longer populated for new events.

### 1c. Indexes for causal tracking

No additional indexes needed for now. The `caused_by` JSON array will be used for UX queries in a future spec. The current spec only needs to write `caused_by` correctly.

---

## 2. InputStore

Create `packages/db/src/input-store.ts`:

```typescript
interface Input {
  id: string;
  workflow_id: string;
  source: string;
  type: string;
  external_id: string;
  title: string;
  created_by_run_id: string | null;
  created_at: number;
}

interface RegisterInputParams {
  source: string;
  type: string;
  id: string;       // external_id
  title: string;
}

class InputStore {
  /**
   * Register an external input. Idempotent by (workflow_id, source, type, external_id).
   * Returns existing inputId if already registered, or creates new.
   */
  async register(
    workflowId: string,
    params: RegisterInputParams,
    createdByRunId: string
  ): Promise<string> {
    // Check if already exists
    const existing = await this.db.get(
      `SELECT id FROM inputs
       WHERE workflow_id = ? AND source = ? AND type = ? AND external_id = ?`,
      [workflowId, params.source, params.type, params.id]
    );

    if (existing) {
      return existing.id;
    }

    // Create new input
    const inputId = generateId();
    await this.db.run(
      `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inputId, workflowId, params.source, params.type, params.id, params.title, createdByRunId, Date.now()]
    );

    return inputId;
  }

  async get(inputId: string): Promise<Input | null> {
    return this.db.get(`SELECT * FROM inputs WHERE id = ?`, [inputId]);
  }

  async getByWorkflow(workflowId: string): Promise<Input[]> {
    return this.db.all(`SELECT * FROM inputs WHERE workflow_id = ?`, [workflowId]);
  }
}
```

Add `inputStore` to `KeepDbApi`.

---

## 3. Update EventStore

### 3a. Update publishEvent to accept caused_by

```typescript
interface PublishEvent {
  messageId: string;
  payload: any;
  // title removed - no longer part of events
}

interface PublishEventInternal extends PublishEvent {
  causedBy: string[];  // array of input IDs, set by host
}

async publishEvent(
  workflowId: string,
  topicName: string,
  event: PublishEventInternal,
  createdByRunId: string
): Promise<void> {
  // ... existing topic resolution logic ...

  await this.db.run(
    `INSERT INTO events (id, topic_id, workflow_id, message_id, title, payload, status, created_by_run_id, caused_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, 'pending', ?, ?, ?, ?)
     ON CONFLICT(topic_id, message_id) DO UPDATE SET
       payload = excluded.payload,
       caused_by = excluded.caused_by,
       updated_at = excluded.updated_at`,
    [id, topicId, workflowId, event.messageId, JSON.stringify(event.payload),
     createdByRunId, JSON.stringify(event.causedBy), now, now]
  );
}
```

Key changes:
- `title` is always empty string `''` for new events (column kept for backward compat)
- `caused_by` is stored as JSON array of input IDs
- On conflict (idempotent re-publish), `caused_by` is also updated (last-write-wins)

### 3b. Add method to get caused_by from reserved events

```typescript
/**
 * Get the union of caused_by from all events reserved by a handler run.
 * Used in consumer's next phase to inherit causal tracking.
 */
async getCausedByForRun(handlerRunId: string): Promise<string[]> {
  const events = await this.db.all(
    `SELECT caused_by FROM events WHERE reserved_by_run_id = ?`,
    [handlerRunId]
  );

  const inputIds = new Set<string>();
  for (const event of events) {
    const causedBy = JSON.parse(event.caused_by || '[]');
    for (const id of causedBy) {
      inputIds.add(id);
    }
  }

  return [...inputIds];
}
```

---

## 4. Topics API Changes

### 4a. Add registerInput tool

Create `packages/agent/src/tools/register-input.ts`:

```typescript
export function makeRegisterInputTool(context: ToolContext): Tool {
  return {
    namespace: 'Topics',    // or could be a separate namespace
    name: 'registerInput',
    description: 'Register an external input in the Input Ledger',
    inputSchema: z.object({
      source: z.string(),   // connector name
      type: z.string(),     // type within source
      id: z.string(),       // external identifier
      title: z.string(),    // human-readable description
    }),
    isReadOnly: () => false,  // creates a record
    execute: async (input) => {
      context.toolWrapper.checkPhaseAllowed('register_input');

      const inputId = await context.api.inputStore.register(
        context.workflowId,
        input,
        context.handlerRunId
      );

      return inputId;
    },
  };
}
```

### 4b. Update phase restrictions

Add `register_input` operation type:

```typescript
type OperationType = 'read' | 'mutate' | 'topic_peek' | 'topic_publish' | 'register_input';

const PHASE_RESTRICTIONS = {
  producer: { read: true,  mutate: false, topic_peek: false, topic_publish: true,  register_input: true },
  prepare:  { read: true,  mutate: false, topic_peek: true,  topic_publish: false, register_input: false },
  mutate:   { read: false, mutate: true,  topic_peek: false, topic_publish: false, register_input: false },
  next:     { read: false, mutate: false, topic_peek: false, topic_publish: true,  register_input: false },
};
```

`register_input` is only allowed in `producer` phase.

### 4c. Update Topics.publish

The publish tool signature changes:

```typescript
// Producer publish: requires inputId, sets caused_by from input
// Consumer next publish: no inputId, inherits caused_by from reserved events

export function makeTopicsPublishTool(context: ToolContext): Tool {
  return {
    name: 'publish',
    inputSchema: z.object({
      topic: z.union([z.string(), z.array(z.string())]),  // single or multi-topic
      event: z.object({
        messageId: z.string(),
        inputId: z.string().optional(),  // required for producer, forbidden in next
        payload: z.any(),
      }),
    }),
    execute: async (input) => {
      context.toolWrapper.checkPhaseAllowed('topic_publish');

      const phase = context.toolWrapper.getPhase();
      const topics = Array.isArray(input.topic) ? input.topic : [input.topic];

      // Validate topics against declared publishes
      validateTopicsAgainstDeclaration(topics, context);

      // Determine caused_by based on phase
      let causedBy: string[];

      if (phase === 'producer') {
        // Producer: inputId is required
        if (!input.event.inputId) {
          throw new LogicError('Producer publish requires inputId. Call registerInput() first.');
        }
        causedBy = [input.event.inputId];
      } else {
        // Consumer next: inputId forbidden, inherit from reserved events
        if (input.event.inputId) {
          throw new LogicError('Consumer publish must not provide inputId. caused_by is inherited from reserved events.');
        }
        causedBy = await context.api.eventStore.getCausedByForRun(context.handlerRunId);
      }

      // Publish to each topic
      for (const topicName of topics) {
        await context.api.eventStore.publishEvent(
          context.workflowId,
          topicName,
          {
            messageId: input.event.messageId,
            payload: input.event.payload,
            causedBy,
          },
          context.handlerRunId
        );
      }
    },
  };
}
```

### 4d. Topic validation against declarations

```typescript
function validateTopicsAgainstDeclaration(
  topics: string[],
  context: ToolContext
): void {
  const config: WorkflowConfig = context.workflowConfig;
  const phase = context.toolWrapper.getPhase();
  const handlerName = context.handlerName;

  let declaredTopics: string[];

  if (phase === 'producer') {
    declaredTopics = config.producers[handlerName]?.publishes || [];
  } else {
    // next phase
    declaredTopics = config.consumers[handlerName]?.publishes || [];
  }

  for (const topic of topics) {
    if (!declaredTopics.includes(topic)) {
      throw new LogicError(
        `Cannot publish to undeclared topic '${topic}'. ` +
        `Declared topics: [${declaredTopics.join(', ')}]`
      );
    }
  }
}
```

This requires the handler execution context to carry `workflowConfig` and `handlerName`. See Section 6 for how these are threaded through.

---

## 5. Script Validation Updates

### 5a. Update WorkflowConfig

```typescript
interface WorkflowConfig {
  topics: string[];
  producers: Record<string, {
    publishes: string[];                              // NEW
    schedule: { interval?: string; cron?: string };
  }>;
  consumers: Record<string, {
    subscribe: string[];
    publishes: string[];                              // NEW
    hasMutate: boolean;
    hasNext: boolean;
  }>;
}
```

### 5b. Update validation code

In `workflow-validator.ts`, update the extraction logic:

```javascript
// Validate producers - updated for new format
const producerConfig = {};
for (const [name, p] of Object.entries(workflow.producers || {})) {
  // Handler can be directly on the object or nested
  const handler = typeof p === 'function' ? p : p.handler;
  if (typeof handler !== 'function' && typeof p.handler !== 'function') {
    throw new Error(`Producer '${name}': handler must be a function`);
  }

  const schedule = p.schedule;
  if (!schedule || (!schedule.interval && !schedule.cron)) {
    throw new Error(`Producer '${name}': schedule with interval or cron required`);
  }

  // publishes is required (array of topic names)
  if (!Array.isArray(p.publishes) || p.publishes.length === 0) {
    throw new Error(`Producer '${name}': publishes must be a non-empty array of topic names`);
  }

  producerConfig[name] = {
    publishes: p.publishes,
    schedule: schedule,
  };
}

// Validate consumers - updated for new format
const consumerConfig = {};
for (const [name, c] of Object.entries(workflow.consumers || {})) {
  if (!Array.isArray(c.subscribe) || c.subscribe.length === 0) {
    throw new Error(`Consumer '${name}': subscribe must be non-empty array`);
  }
  if (typeof c.prepare !== 'function') {
    throw new Error(`Consumer '${name}': prepare must be a function`);
  }

  // publishes is optional (empty array if not provided)
  const publishes = Array.isArray(c.publishes) ? c.publishes : [];

  // If consumer has next but no publishes, that's fine (next may only return state)
  // If consumer has publishes but no next, that's a warning (can't publish without next)
  if (publishes.length > 0 && c.next === undefined) {
    throw new Error(`Consumer '${name}': declares publishes but has no next function`);
  }

  consumerConfig[name] = {
    subscribe: c.subscribe,
    publishes,
    hasMutate: typeof c.mutate === 'function',
    hasNext: typeof c.next === 'function',
  };
}
```

### 5c. Validate topic graph

Add static validation that all referenced topics exist:

```javascript
const declaredTopics = new Set(Object.keys(workflow.topics || {}));

// Check producer publishes reference declared topics
for (const [name, p] of Object.entries(producerConfig)) {
  for (const topic of p.publishes) {
    if (!declaredTopics.has(topic)) {
      throw new Error(`Producer '${name}': publishes to undeclared topic '${topic}'`);
    }
  }
}

// Check consumer subscribe and publishes reference declared topics
for (const [name, c] of Object.entries(consumerConfig)) {
  for (const topic of c.subscribe) {
    if (!declaredTopics.has(topic)) {
      throw new Error(`Consumer '${name}': subscribes to undeclared topic '${topic}'`);
    }
  }
  for (const topic of c.publishes) {
    if (!declaredTopics.has(topic)) {
      throw new Error(`Consumer '${name}': publishes to undeclared topic '${topic}'`);
    }
  }
}
```

---

## 6. Handler Execution Context Updates

The handler execution context must carry additional information for topic validation and causal tracking.

### 6a. Extend ToolContext

The context passed to tool factories needs:

```typescript
interface ToolContext {
  // ... existing fields ...
  workflowConfig: WorkflowConfig;   // NEW: for topic validation
  handlerName: string;               // NEW: for topic validation
}
```

These are already available in the handler state machine (from `workflow.handler_config` and `run.handler_name`). They just need to be threaded through to tool creation.

### 6b. Update handler state machine

In `createHandlerSandbox()` or equivalent, pass the config and handler name when creating tools:

```typescript
// When setting up sandbox for a handler run:
const config = JSON.parse(workflow.handler_config);
const toolContext = {
  ...existingContext,
  workflowConfig: config,
  handlerName: run.handler_name,
};
```

### 6c. Inject registerInput into sandbox globals

In `createWorkflowTools()` or sandbox setup:

```typescript
// Add to Topics namespace
global['Topics'] = {
  peek: wrapTool(makeTopicsPeekTool(context)),
  getByIds: wrapTool(makeTopicsGetByIdsTool(context)),
  publish: wrapTool(makeTopicsPublishTool(context)),
  registerInput: wrapTool(makeRegisterInputTool(context)),  // NEW
};
```

Alternative: `registerInput` could be on a `ctx` object passed to the handler. But since the current model uses global `Topics.*`, keeping it as `Topics.registerInput()` is consistent. The doc shows `ctx.registerInput()` but since we use globals, `Topics.registerInput()` is the equivalent.

---

## 7. Planner Prompt Updates

In `packages/agent/src/agent-env.ts`, update the planner prompt:

### 7a. Update producer section

Replace the current producer example/docs with:

```
### Producers
Poll external systems, register inputs, and publish events:

producers: {
  producerName: {
    publishes: ["topic.name"],           // required: declare target topics
    schedule: { interval: "5m" },        // or { cron: "0 * * * *" }
    handler: async (state) => {
      // 1. Read from external system
      // 2. Register each input with Topics.registerInput()
      // 3. Publish events with Topics.publish() referencing the inputId
      // 4. Return new state
    }
  }
}
```

### 7b. Update consumer section

```
### Consumers
Process events in three phases:

consumers: {
  consumerName: {
    subscribe: ["topic.name"],
    publishes: ["downstream.topic"],     // optional: topics emitted in next

    prepare: async (state) => {
      const events = await Topics.peek("topic.name");
      if (events.length === 0) return { reservations: [], data: {} };
      return {
        reservations: [{ topic: "topic.name", ids: [events[0].messageId] }],
        data: { /* computed from events */ },
        ui: { title: "What this mutation does" },  // user-facing description
      };
    },

    mutate: async (prepared) => { ... },

    next: async (prepared, mutationResult) => {
      // No inputId needed — host inherits caused_by from reserved events
      if (mutationResult.status === 'applied') {
        await Topics.publish("downstream.topic", {
          messageId: "...",
          payload: { ... },
        });
      }
    },
  }
}
```

### 7c. Update event design section

Replace:
```
### Event Design
Events are internal workflow coordination. They do NOT have titles.
User-facing metadata is handled by the Input Ledger (Topics.registerInput).

#### messageId
- Must be stable and unique within topic
- Based on external identifier (email ID, row ID, etc.)
- Used for idempotent publishing (duplicates update payload)

Good: `email.id`, `row:${invoice.id}`
Bad: `uuid()`, `Date.now()`

#### Input Registration
Producers must register external inputs BEFORE publishing events:

const inputId = Topics.registerInput({
  source: "gmail",
  type: "email",
  id: email.id,
  title: `Email from ${email.from}: "${email.subject}"`
});

await Topics.publish("email.received", {
  messageId: email.id,
  inputId,              // required in producer publish
  payload: { ... },
});

Input titles must:
- Include a stable external identifier
- Include a human-recognizable descriptor
- Describe what the input IS, not how it's processed

Good: `Email from alice@example.com: "Invoice December"`
Bad: `Processing item` or `Item #5`
```

### 7d. Update phase rules

```
### Producer Phase
- CAN: Read external systems, publish to declared topics, register inputs
- CANNOT: Mutate external systems, peek topics, publish to undeclared topics

### Prepare Phase
- CAN: Read external systems, peek subscribed topics
- CANNOT: Mutate external systems, publish to topics, register inputs
- MUST: Return { reservations, data }
- SHOULD: Return { ui: { title: "..." } } when mutation will occur

### Mutate Phase
- CAN: Perform ONE external mutation
- CANNOT: Read external systems, peek/publish topics
- NOTE: Mutation is terminal - no code after the mutation call

### Next Phase
- CAN: Publish to declared topics (no inputId needed)
- CANNOT: Read/mutate external systems, peek topics, register inputs
```

### 7e. Update full example

Replace the full workflow example with the one from 06a that includes `publishes`, `registerInput`, `inputId`, and `ui.title`.

---

## 8. Maintainer Prompt Updates

### 8a. Update constraints

Add to "Cannot Modify":
- Producer `publishes` declarations (would break event routing)
- Consumer `publishes` declarations (would break downstream routing)

Add to "Must Preserve":
- Input registration logic (registerInput calls)
- inputId linkage in producer publish calls

---

## 9. PrepareResult.ui Structure

### 9a. Type definition

```typescript
interface PrepareResult {
  reservations: Array<{ topic: string; ids: string[] }>;
  data?: unknown;
  ui?: {
    title: string;    // user-facing description of the mutation
  };
  wakeAt?: string;    // ISO 8601 (from exec-11, if implemented)
}
```

### 9b. Store ui.title in mutation record

When creating a mutation record in the `mutating` phase, extract `ui.title` from the PrepareResult and store it:

```typescript
// In executeMutate (handler-state-machine.ts)
const prepareResult = JSON.parse(run.prepare_result);

const mutation = await mutationStore.create({
  handlerRunId: run.id,
  workflowId: run.workflow_id,
  status: 'pending',
  uiTitle: prepareResult.ui?.title || null,  // store for UX
});
```

This requires adding a `ui_title` column to the `mutations` table:

```sql
ALTER TABLE mutations ADD COLUMN ui_title TEXT;
```

---

## Implementation Order

### Step 1: Database migration

Create migration (next version after v38):
1. Create `inputs` table
2. Add `caused_by` column to `events`
3. Add `ui_title` column to `mutations`

### Step 2: InputStore

1. Create `packages/db/src/input-store.ts`
2. Add `inputStore` to `KeepDbApi`
3. Unit test: idempotent registration

### Step 3: EventStore updates

1. Update `publishEvent()` — accept `causedBy`, stop requiring `title`
2. Add `getCausedByForRun()` method
3. Update `PublishEvent` interface (remove `title`)
4. Unit test: caused_by stored and retrieved correctly

### Step 4: Topics API updates

1. Create `register-input.ts` tool
2. Update phase restrictions (add `register_input`)
3. Update `Topics.publish` tool:
   - Multi-topic support
   - `inputId` required for producer / forbidden for consumer
   - `caused_by` computation
   - Topic validation against declarations
4. Add `Topics.registerInput` to sandbox globals
5. Unit test: phase restrictions, causal tracking

### Step 5: Validation updates

1. Update `WorkflowConfig` interface (add `publishes`)
2. Update extraction logic for new producer/consumer format
3. Add topic graph validation (all referenced topics declared)
4. Unit test: new format validates correctly, old format fails with clear error

### Step 6: Handler context threading

1. Pass `workflowConfig` and `handlerName` through to tool context
2. Verify topic validation works end-to-end

### Step 7: Prompt updates

1. Update planner prompt (producer/consumer/event sections)
2. Update maintainer prompt (new constraints)

---

## Database Changes Summary

```sql
-- New table: Input Ledger
CREATE TABLE inputs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by_run_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(workflow_id, source, type, external_id)
);
CREATE INDEX idx_inputs_workflow ON inputs(workflow_id);
SELECT crsql_as_crr('inputs');

-- Events: add causal tracking
ALTER TABLE events ADD COLUMN caused_by TEXT NOT NULL DEFAULT '[]';

-- Mutations: add semantic title from prepareResult.ui
ALTER TABLE mutations ADD COLUMN ui_title TEXT;
```

---

## Backward Compatibility

- Existing events with `title` values are preserved. New events get `title = ''`.
- Existing `WorkflowConfig` without `publishes` will fail validation. This is intentional — scripts must be re-planned with the new format. The planner prompt update ensures new scripts use the correct format.
- Existing handler_runs and mutations are unaffected. Only new runs will use the updated publish flow.
- The `Topics.publish` signature is backward-incompatible (no more `title` in event). Since all existing scripts need re-planning anyway (exec-02 deprecated Items), this is acceptable.

---

## Testing

### Unit tests
- InputStore: idempotent registration, unique constraint
- EventStore: publishEvent with caused_by, getCausedByForRun
- Topics.publish: phase restrictions, inputId required/forbidden per phase
- Topics.publish: multi-topic fan-out
- Topics.publish: topic validation against declarations
- Topics.registerInput: phase restriction (producer only)
- Validation: new producer format (with publishes)
- Validation: new consumer format (with publishes)
- Validation: undeclared topic in publishes → error

### Integration tests
- Full flow: producer registerInput → publish with inputId → consumer peek → reserve → next publish → caused_by inherited
- Causal chain: 3-stage pipeline, all events trace back to original input

---

## References

- docs/dev/06a-topics-and-handlers.md — Input Ledger, Causal Tracking, Producer/Consumer declarations
- docs/dev/06b-consumer-lifecycle.md — PrepareResult.ui field
- docs/dev/17-inputs-outputs.md — UX layer (NOT implemented in this spec)
- specs/done/exec-01-database-schema.md — current schema
- specs/done/exec-03-topics-api.md — current Topics API
- specs/done/exec-04-phase-tracking.md — current phase restrictions
- specs/done/exec-05-script-validation.md — current validation
- specs/done/exec-08-planner-prompts.md — current prompts
