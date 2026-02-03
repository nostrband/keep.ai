/**
 * Topics namespace tools for event-driven execution model (exec-03).
 *
 * Provides Topics.peek, Topics.getByIds, and Topics.publish for
 * managing internal event streams in the new workflow execution model.
 *
 * Phase restrictions are enforced by the caller (ToolWrapper or handler state machine):
 * - Topics.peek: Only in prepare phase
 * - Topics.getByIds: Only in prepare phase
 * - Topics.publish: Only in producer or next phase
 */
import { z } from "zod";
import { defineReadOnlyTool, defineTool, Tool } from "./types";
import { EventStore, Event, PublishEvent, PeekEventsOptions } from "@app/db";

// ============================================================================
// Schemas
// ============================================================================

const EventSchema = z.object({
  messageId: z.string(),
  title: z.string(),
  payload: z.any(),
  status: z.enum(["pending", "reserved", "consumed", "skipped"]),
  createdAt: z.number(),
});

const PublishEventSchema = z.object({
  messageId: z.string().describe("Unique ID within topic for idempotent publishing (e.g., external entity ID)"),
  title: z.string().describe("Human-readable description for observability"),
  payload: z.any().describe("Arbitrary JSON data for downstream consumers"),
});

// ============================================================================
// Topics.peek
// ============================================================================

const peekInputSchema = z.object({
  topic: z.string().describe("Topic name to peek events from"),
  limit: z.number().min(1).max(1000).optional().describe("Maximum events to return (default: 100)"),
});

const peekOutputSchema = z.array(EventSchema);

type PeekInput = z.infer<typeof peekInputSchema>;
type PeekOutput = z.infer<typeof peekOutputSchema>;

/**
 * Create the Topics.peek tool.
 *
 * Returns pending events from a topic without changing their status.
 * Used in consumer prepare phase to select work to process.
 *
 * Phase: prepare only (enforced by caller)
 */
export function makeTopicsPeekTool(
  eventStore: EventStore,
  getWorkflowId: () => string | undefined,
  getHandlerRunId: () => string | undefined
): Tool<PeekInput, PeekOutput> {
  return defineReadOnlyTool({
    namespace: "Topics",
    name: "peek",
    description: `Peek pending events from a topic without reserving them.
Use in prepare phase to select events for processing.

Example:
  const pending = await Topics.peek({ topic: "email.received", limit: 10 });
  if (pending.length === 0) return { reservations: [], data: {} };
  const event = pending[0];
  return {
    reservations: [{ topic: "email.received", ids: [event.messageId] }],
    data: { emailId: event.payload.id },
  };

Note: Phase-restricted to 'prepare' phase only.`,
    inputSchema: peekInputSchema,
    outputSchema: peekOutputSchema,
    execute: async (input: PeekInput): Promise<PeekOutput> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Topics.peek requires a workflow context");
      }

      const options: PeekEventsOptions = {
        limit: input.limit ?? 100,
        status: "pending",
      };

      const events = await eventStore.peekEvents(workflowId, input.topic, options);

      return events.map(mapEventToOutput);
    },
  }) as Tool<PeekInput, PeekOutput>;
}

// ============================================================================
// Topics.getByIds
// ============================================================================

const getByIdsInputSchema = z.object({
  topic: z.string().describe("Topic name"),
  ids: z.array(z.string()).describe("Array of messageIds to retrieve"),
});

const getByIdsOutputSchema = z.array(EventSchema);

type GetByIdsInput = z.infer<typeof getByIdsInputSchema>;
type GetByIdsOutput = z.infer<typeof getByIdsOutputSchema>;

/**
 * Create the Topics.getByIds tool.
 *
 * Returns events by their messageIds within a topic.
 * Used in prepare phase to retrieve specific events.
 *
 * Phase: prepare only (enforced by caller)
 */
export function makeTopicsGetByIdsTool(
  eventStore: EventStore,
  getWorkflowId: () => string | undefined
): Tool<GetByIdsInput, GetByIdsOutput> {
  return defineReadOnlyTool({
    namespace: "Topics",
    name: "getByIds",
    description: `Get events by their messageIds within a topic.
Use to retrieve specific events for inspection.

Example:
  const events = await Topics.getByIds({
    topic: "email.received",
    ids: ["msg-123", "msg-456"]
  });

Note: Phase-restricted to 'prepare' phase only.`,
    inputSchema: getByIdsInputSchema,
    outputSchema: getByIdsOutputSchema,
    execute: async (input: GetByIdsInput): Promise<GetByIdsOutput> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Topics.getByIds requires a workflow context");
      }

      const events = await eventStore.getEventsByIds(workflowId, input.topic, input.ids);

      return events.map(mapEventToOutput);
    },
  }) as Tool<GetByIdsInput, GetByIdsOutput>;
}

// ============================================================================
// Topics.publish
// ============================================================================

const publishInputSchema = z.object({
  topic: z.string().describe("Topic name to publish to"),
  event: PublishEventSchema,
});

const publishOutputSchema = z.void();

type PublishInput = z.infer<typeof publishInputSchema>;
type PublishOutput = void;

/**
 * Create the Topics.publish tool.
 *
 * Publishes an event to a topic. Idempotent by messageId - duplicate
 * messageIds are silently ignored.
 *
 * Phase: producer or next only (enforced by caller)
 */
export function makeTopicsPublishTool(
  eventStore: EventStore,
  getWorkflowId: () => string | undefined,
  getHandlerRunId: () => string | undefined
): Tool<PublishInput, PublishOutput> {
  return defineTool({
    namespace: "Topics",
    name: "publish",
    description: `Publish an event to a topic.
Idempotent by messageId - duplicates are silently ignored.

Example (in producer handler):
  await Topics.publish({
    topic: "email.received",
    event: {
      messageId: email.id,  // Stable ID for idempotency
      title: \`Email from \${email.from}: "\${email.subject}"\`,
      payload: { id: email.id, from: email.from, subject: email.subject }
    }
  });

Example (in next phase):
  await Topics.publish({
    topic: "row.created",
    event: {
      messageId: \`row:\${emailId}\`,
      title: \`Row created for email from \${from}\`,
      payload: { emailId }
    }
  });

Note: Phase-restricted to 'producer' or 'next' phase only.`,
    inputSchema: publishInputSchema,
    outputSchema: publishOutputSchema,
    isReadOnly: () => false, // This is a write operation (creates events)
    execute: async (input: PublishInput): Promise<PublishOutput> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Topics.publish requires a workflow context");
      }

      const handlerRunId = getHandlerRunId() || "";

      const publishEvent: PublishEvent = {
        messageId: input.event.messageId,
        title: input.event.title,
        payload: input.event.payload,
      };

      await eventStore.publishEvent(workflowId, input.topic, publishEvent, handlerRunId);
    },
  }) as Tool<PublishInput, PublishOutput>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map internal Event to output format.
 */
function mapEventToOutput(event: Event): z.infer<typeof EventSchema> {
  return {
    messageId: event.message_id,
    title: event.title,
    payload: event.payload,
    status: event.status,
    createdAt: event.created_at,
  };
}
