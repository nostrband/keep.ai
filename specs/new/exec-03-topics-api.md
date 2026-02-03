# exec-03: Topics Global API

## Goal

Add `Topics` namespace to sandbox globals for event stream operations. This is internal infrastructure (not external tools) with phase-restricted access.

## API Design

```typescript
// Available as globalThis.Topics in sandbox

Topics.peek(topicName: string, options?: { limit?: number }): Promise<Event[]>
// Returns pending events from topic (prepare phase only)

Topics.getByIds(topicName: string, ids: string[]): Promise<Event[]>
// Returns events by messageId (prepare phase only)

Topics.publish(topicName: string, event: PublishEvent): Promise<void>
// Publishes event to topic (producer/next phase only)

interface PublishEvent {
  messageId: string;  // Unique within topic, for idempotent publishing
  title: string;      // Human-readable, required for observability
  payload: any;       // Arbitrary JSON data
}

interface Event {
  messageId: string;
  title: string;
  payload: any;
  status: 'pending' | 'reserved' | 'consumed' | 'skipped';
  createdAt: number;
}
```

## Phase Restrictions

| Method | Producer | prepare | mutate | next |
|--------|----------|---------|--------|------|
| Topics.peek | ✗ | ✓ | ✗ | ✗ |
| Topics.getByIds | ✗ | ✓ | ✗ | ✗ |
| Topics.publish | ✓ | ✗ | ✗ | ✓ |

Phase violations throw `LogicError`.

## Implementation

### 1. Create Topics Tool (`packages/agent/src/tools/topics.ts`)

```typescript
import { Tool } from './tool-interface';

export const topicsPeekTool: Tool = {
  namespace: 'Topics',
  name: 'peek',
  description: 'Get pending events from a topic',
  inputSchema: z.object({
    topic: z.string(),
    limit: z.number().optional().default(100),
  }),
  isReadOnly: () => true,  // But phase-restricted
  execute: async (input, context) => {
    context.sandboxApi.checkPhaseAllowed('topic_peek');
    return context.eventStore.peekEvents(
      context.workflowId,
      input.topic,
      { limit: input.limit, status: 'pending' }
    );
  },
};

export const topicsPublishTool: Tool = {
  namespace: 'Topics',
  name: 'publish',
  description: 'Publish an event to a topic',
  inputSchema: z.object({
    topic: z.string(),
    event: z.object({
      messageId: z.string(),
      title: z.string(),
      payload: z.any(),
    }),
  }),
  isReadOnly: () => false,
  execute: async (input, context) => {
    context.sandboxApi.checkPhaseAllowed('topic_publish');
    await context.eventStore.publishEvent(
      context.workflowId,
      input.topic,
      input.event,
      context.handlerRunId
    );
  },
};
```

### 2. Add to SandboxAPI

In `packages/agent/src/sandbox/api.ts`:

```typescript
// In createGlobal():
global['Topics'] = {
  peek: this.wrapTool(topicsPeekTool),
  getByIds: this.wrapTool(topicsGetByIdsTool),
  publish: this.wrapTool(topicsPublishTool),
};
```

### 3. EventStore Methods

In `packages/db/src/event-store.ts`:

```typescript
class EventStore {
  async peekEvents(workflowId: string, topicName: string, options: { limit: number, status: string }): Promise<Event[]>

  async getEventsByIds(workflowId: string, topicName: string, messageIds: string[]): Promise<Event[]>

  async publishEvent(workflowId: string, topicName: string, event: PublishEvent, createdByRunId: string): Promise<void>
  // Idempotent by messageId - ignores duplicates

  async reserveEvents(handlerRunId: string, reservations: Array<{ topic: string, ids: string[] }>): Promise<void>
  // Sets status='reserved', reserved_by_run_id

  async consumeEvents(handlerRunId: string): Promise<void>
  // Sets status='consumed' for all events reserved by this run

  async skipEvents(handlerRunId: string): Promise<void>
  // Sets status='skipped' for all events reserved by this run
}
```

## Testing

- Test Topics.peek returns only pending events
- Test Topics.publish is idempotent (same messageId ignored)
- Test phase restrictions throw LogicError
- Test events flow: publish → peek → reserve → consume
