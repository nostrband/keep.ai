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
import { JSONSchema } from "../json-schema";
import { defineReadOnlyTool, defineTool, Tool } from "./types";
import { EventStore, Event, PublishEvent, PeekEventsOptions, InputStore } from "@app/db";
import { WorkflowConfig } from "../workflow-validator";

// ============================================================================
// Schemas
// ============================================================================

const EventSchema: JSONSchema = {
  type: "object",
  properties: {
    messageId: { type: "string" },
    title: { type: "string" },
    payload: {},
    status: { enum: ["pending", "reserved", "consumed", "skipped"] },
    createdAt: { type: "number" },
  },
  required: ["messageId", "title", "payload", "status", "createdAt"],
};

interface EventOutput {
  messageId: string;
  title: string;
  payload: any;
  status: "pending" | "reserved" | "consumed" | "skipped";
  createdAt: number;
}

const PublishEventSchema: JSONSchema = {
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "Unique ID within topic for idempotent publishing (e.g., external entity ID)",
    },
    /**
     * @deprecated Per exec-15, event titles are deprecated. User-facing metadata
     * should be stored in the Input Ledger via Topics.registerInput().
     */
    title: {
      type: "string",
      description: "Deprecated: use Input Ledger for user-facing metadata",
    },
    payload: {
      description: "Arbitrary JSON data for downstream consumers",
    },
    /**
     * Input ID from Topics.registerInput(). Required in producer phase,
     * forbidden in next phase (causedBy is inherited from reserved events).
     */
    inputId: {
      type: "string",
      description: "Input ID for causal tracking (required in producer phase)",
    },
    /** Array of input IDs that caused this event (exec-15 causal tracking) - internal use */
    causedBy: {
      type: "array",
      items: { type: "string" },
      description: "Input IDs for causal tracking (set automatically)",
    },
  },
  required: ["messageId"],
};

// ============================================================================
// Topics.peek
// ============================================================================

const peekInputSchema: JSONSchema = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Topic name to peek events from" },
    limit: {
      type: "number",
      minimum: 1,
      maximum: 1000,
      description: "Maximum events to return (default: 100)",
    },
  },
  required: ["topic"],
};

const peekOutputSchema: JSONSchema = {
  type: "array",
  items: EventSchema,
};

interface PeekInput {
  topic: string;
  limit?: number;
}

type PeekOutput = EventOutput[];

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

const getByIdsInputSchema: JSONSchema = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Topic name" },
    ids: {
      type: "array",
      items: { type: "string" },
      description: "Array of messageIds to retrieve",
    },
  },
  required: ["topic", "ids"],
};

const getByIdsOutputSchema: JSONSchema = {
  type: "array",
  items: EventSchema,
};

interface GetByIdsInput {
  topic: string;
  ids: string[];
}

type GetByIdsOutput = EventOutput[];

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

const publishInputSchema: JSONSchema = {
  type: "object",
  properties: {
    topic: {
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
      ],
      description: "Topic name(s) to publish to - can be single topic or array for fan-out",
    },
    event: PublishEventSchema,
  },
  required: ["topic", "event"],
};

interface PublishInput {
  topic: string | string[];
  event: {
    messageId: string;
    title?: string;
    payload?: any;
    inputId?: string;
    causedBy?: string[];
  };
}

type PublishOutput = void;

/**
 * Create the Topics.publish tool.
 *
 * Publishes an event to one or more topics. Idempotent by messageId - duplicate
 * messageIds are silently ignored.
 *
 * Phase: producer or next only (enforced by caller)
 *
 * In producer phase:
 * - inputId is required (from Topics.registerInput())
 * - causedBy is set to [inputId]
 * - Topics must be in producer's publishes declaration
 *
 * In next phase:
 * - inputId is forbidden
 * - causedBy is inherited from reserved events (via getCausedByForRun)
 * - Topics must be in consumer's publishes declaration
 *
 * @param eventStore - EventStore for publishing events
 * @param getWorkflowId - Function to get current workflow ID
 * @param getHandlerRunId - Function to get current handler run ID
 * @param getPhase - Optional function to get current phase for validation
 * @param getHandlerName - Optional function to get current handler name for topic validation
 * @param getWorkflowConfig - Optional function to get workflow config for topic validation
 */
export function makeTopicsPublishTool(
  eventStore: EventStore,
  getWorkflowId: () => string | undefined,
  getHandlerRunId: () => string | undefined,
  getPhase?: () => 'producer' | 'next' | null,
  getHandlerName?: () => string | undefined,
  getWorkflowConfig?: () => WorkflowConfig | undefined
): Tool<PublishInput, PublishOutput> {
  return defineTool({
    namespace: "Topics",
    name: "publish",
    description: `Publish an event to one or more topics.
Idempotent by messageId - duplicates are silently ignored.
Supports multi-topic fan-out for a single event.

Example (in producer handler with Input Ledger):
  const inputId = await Topics.registerInput({
    source: "gmail",
    type: "email",
    id: email.id,
    title: \`Email from \${email.from}: "\${email.subject}"\`
  });

  await Topics.publish({
    topic: "email.received",  // or ["email.received", "audit.log"] for fan-out
    event: {
      messageId: email.id,
      inputId,  // Required in producer phase
      payload: { id: email.id, from: email.from, subject: email.subject }
    }
  });

Example (in next phase):
  await Topics.publish({
    topic: "row.created",
    event: {
      messageId: \`row:\${emailId}\`,
      // No inputId needed - causedBy inherited from reserved events
      payload: { emailId }
    }
  });

Note: Phase-restricted to 'producer' or 'next' phase only.`,
    inputSchema: publishInputSchema,
    isReadOnly: () => false, // This is a write operation (creates events)
    execute: async (input: PublishInput): Promise<PublishOutput> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Topics.publish requires a workflow context");
      }

      const handlerRunId = getHandlerRunId() || "";
      const phase = getPhase?.() ?? null;
      const handlerName = getHandlerName?.();
      const workflowConfig = getWorkflowConfig?.();

      // Normalize topic to array for multi-topic support
      const topics = Array.isArray(input.topic) ? input.topic : [input.topic];

      // Validate topics against declarations if we have config context (exec-15)
      if (handlerName && workflowConfig && phase) {
        let declaredTopics: string[] | undefined;

        if (phase === 'producer') {
          declaredTopics = workflowConfig.producers?.[handlerName]?.publishes;
        } else if (phase === 'next') {
          declaredTopics = workflowConfig.consumers?.[handlerName]?.publishes;
        }

        if (declaredTopics) {
          for (const topic of topics) {
            if (!declaredTopics.includes(topic)) {
              throw new Error(
                `Cannot publish to undeclared topic '${topic}'. ` +
                `Handler '${handlerName}' declares: [${declaredTopics.join(', ')}]`
              );
            }
          }
        }
      }

      // Determine causedBy based on phase and inputId
      let causedBy: string[] | undefined;

      if (phase === 'producer') {
        // Producer phase: inputId is required
        if (!input.event.inputId) {
          throw new Error(
            "Topics.publish in producer phase requires inputId. " +
            "Call Topics.registerInput() first and pass the returned inputId."
          );
        }
        causedBy = [input.event.inputId];
      } else if (phase === 'next') {
        // Next phase: inputId is forbidden, inherit from reserved events
        if (input.event.inputId) {
          throw new Error(
            "Topics.publish in next phase must not provide inputId. " +
            "Causal tracking is inherited from reserved events."
          );
        }
        // Get causedBy from all events reserved by this handler run
        causedBy = await eventStore.getCausedByForRun(handlerRunId);
      } else {
        // No phase info available (task mode or legacy) - use provided values
        if (input.event.inputId) {
          causedBy = [input.event.inputId];
        } else if (input.event.causedBy) {
          causedBy = input.event.causedBy;
        }
      }

      // Build the publish event
      const publishEvent: PublishEvent = {
        messageId: input.event.messageId,
        title: input.event.title, // Deprecated but accepted for backward compat
        payload: input.event.payload,
        causedBy,
      };

      // Publish to each topic
      for (const topicName of topics) {
        await eventStore.publishEvent(workflowId, topicName, publishEvent, handlerRunId);
      }
    },
  }) as Tool<PublishInput, PublishOutput>;
}

// ============================================================================
// Topics.registerInput
// ============================================================================

const registerInputOutputSchema: JSONSchema = {
  type: "string",
  description: "The generated inputId",
};

interface RegisterInputInput {
  source: string;
  type: string;
  id: string;
  title: string;
}

type RegisterInputOutput = string;

/**
 * Create the Topics.registerInput tool.
 *
 * Registers an external input in the Input Ledger. Idempotent by
 * (workflow_id, source, type, external_id) - re-registering returns existing inputId.
 *
 * The returned inputId must be passed to Topics.publish() in producer phase
 * to establish causal tracking.
 *
 * Phase: producer only (enforced by caller)
 *
 * @param validInputTypes - Optional registry of valid source→type mappings.
 *   When provided, source and type are validated against it before registration.
 */
export function makeTopicsRegisterInputTool(
  inputStore: InputStore,
  getWorkflowId: () => string | undefined,
  getHandlerRunId: () => string | undefined,
  validInputTypes?: Map<string, Set<string>>
): Tool<RegisterInputInput, RegisterInputOutput> {
  // Build description with valid pairs if registry is provided
  let validPairsDoc = "";
  if (validInputTypes && validInputTypes.size > 0) {
    const pairs = Array.from(validInputTypes.entries())
      .map(([source, types]) => `  ${source}: ${Array.from(types).join(", ")}`)
      .join("\n");
    validPairsDoc = `\n\nValid source/type pairs:\n${pairs}`;
  }

  const registerInputInputSchema: JSONSchema = {
    type: "object",
    properties: {
      source: { type: "string", description: "Connector namespace (e.g., 'Gmail', 'GoogleSheets', 'System')" },
      type: { type: "string", description: "Type within source (e.g., 'email', 'row', 'page')" },
      id: { type: "string", description: "External identifier from source system" },
      title: { type: "string", description: "Human-readable description for user display" },
    },
    required: ["source", "type", "id", "title"],
  };

  return defineTool({
    namespace: "Topics",
    name: "registerInput",
    description: `Register an external input in the Input Ledger.
Idempotent by (source, type, id) - re-registering returns existing inputId.

The returned inputId must be passed to Topics.publish() to establish causal tracking.

Example:
  const inputId = await Topics.registerInput({
    source: "Gmail",
    type: "email",
    id: email.id,
    title: \`Email from \${email.from}: "\${email.subject}"\`
  });

  await Topics.publish({
    topic: "email.received",
    event: {
      messageId: email.id,
      inputId,  // Required in producer phase
      payload: { id: email.id, from: email.from, subject: email.subject }
    }
  });${validPairsDoc}

Note: Phase-restricted to 'producer' phase only.`,
    inputSchema: registerInputInputSchema,
    outputSchema: registerInputOutputSchema,
    isReadOnly: () => false, // This creates records in the input ledger
    execute: async (input: RegisterInputInput): Promise<RegisterInputOutput> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Topics.registerInput requires a workflow context");
      }

      // Validate source/type against registry if provided
      if (validInputTypes) {
        const validTypes = validInputTypes.get(input.source);
        if (!validTypes) {
          const validSources = Array.from(validInputTypes.keys()).join(", ");
          throw new Error(
            `Invalid source '${input.source}'. Valid sources: ${validSources}`
          );
        }
        if (!validTypes.has(input.type)) {
          const validTypesList = Array.from(validTypes).join(", ");
          throw new Error(
            `Invalid type '${input.type}' for source '${input.source}'. Valid types: ${validTypesList}`
          );
        }
      }

      const handlerRunId = getHandlerRunId() || "";

      const inputId = await inputStore.register(
        workflowId,
        {
          source: input.source,
          type: input.type,
          id: input.id,
          title: input.title,
        },
        handlerRunId
      );

      return inputId;
    },
  }) as Tool<RegisterInputInput, RegisterInputOutput>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map internal Event to output format.
 */
function mapEventToOutput(event: Event): EventOutput {
  return {
    messageId: event.message_id,
    title: event.title,
    payload: event.payload,
    status: event.status,
    createdAt: event.created_at,
  };
}
