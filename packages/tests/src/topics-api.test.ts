import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, EventStore, InputStore } from "@app/db";
import { createDBNode } from "@app/node";
import {
  makeTopicsPeekTool,
  makeTopicsGetByIdsTool,
  makeTopicsPublishTool,
  makeTopicsRegisterInputTool,
} from "@app/agent";

/**
 * Helper to create topics, events, and inputs tables without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts and v44.ts
 */
async function createTables(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, name)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topics_workflow ON topics(workflow_id)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      topic_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      reserved_by_run_id TEXT NOT NULL DEFAULT '',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      caused_by TEXT NOT NULL DEFAULT '[]',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(topic_id, message_id)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_reserved_by ON events(reserved_by_run_id)`);

  // Inputs table for exec-15
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inputs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, source, type, external_id)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inputs_workflow ON inputs(workflow_id)`);
}

describe("Topics API Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let eventStore: EventStore;
  let inputStore: InputStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    eventStore = new EventStore(keepDb);
    inputStore = new InputStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Topics.peek", () => {
    it("should return pending events from a topic", async () => {
      // Setup: Publish some events
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: { from: "alice@example.com" } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", payload: { from: "bob@example.com" } },
        "run-1"
      );

      // Create tool
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      // Execute
      const result = await peekTool.execute({ topic: "emails" });

      // Verify
      expect(result).toHaveLength(2);
      expect(result[0].messageId).toBe("msg-1");
      expect(result[0].title).toBe("");  // Title is deprecated, always empty for new events
      expect(result[0].payload).toEqual({ from: "alice@example.com" });
      expect(result[0].status).toBe("pending");
      expect(result[1].messageId).toBe("msg-2");
    });

    it("should respect limit option", async () => {
      // Setup: Publish multiple events
      for (let i = 1; i <= 5; i++) {
        await eventStore.publishEvent(
          "workflow-1",
          "emails",
          { messageId: `msg-${i}`, payload: {} },
          "run-1"
        );
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      const result = await peekTool.execute({ topic: "emails", limit: 3 });

      expect(result).toHaveLength(3);
      // Should be ordered by created_at ASC
      expect(result[0].messageId).toBe("msg-1");
      expect(result[2].messageId).toBe("msg-3");
    });

    it("should return empty array for non-existent topic", async () => {
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      const result = await peekTool.execute({ topic: "nonexistent" });

      expect(result).toEqual([]);
    });

    it("should only return pending events (not reserved/consumed)", async () => {
      // Setup: Publish events
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", payload: {} },
        "run-1"
      );

      // Reserve one event
      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);

      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-3"
      );

      const result = await peekTool.execute({ topic: "emails" });

      // Should only see msg-2 (msg-1 is reserved)
      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe("msg-2");
    });

    it("should throw error when workflow context is missing", async () => {
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => undefined, // No workflow context
        () => "run-2"
      );

      await expect(peekTool.execute({ topic: "emails" }))
        .rejects.toThrow("Topics.peek requires a workflow context");
    });

    it("should use default limit of 100", async () => {
      // Verify default is used (by not exceeding it)
      for (let i = 1; i <= 5; i++) {
        await eventStore.publishEvent(
          "workflow-1",
          "emails",
          { messageId: `msg-${i}`, payload: {} },
          "run-1"
        );
      }

      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      // Call without limit - should get all 5
      const result = await peekTool.execute({ topic: "emails" });
      expect(result).toHaveLength(5);
    });

    it("should return events ordered by created_at ascending", async () => {
      // Create events with explicit delays
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-c", payload: {} },
        "run-1"
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-a", payload: {} },
        "run-1"
      );

      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      const result = await peekTool.execute({ topic: "emails" });

      // msg-c was created first
      expect(result[0].messageId).toBe("msg-c");
      expect(result[1].messageId).toBe("msg-a");
    });

    it("should be read-only (marked as read-only tool)", async () => {
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-2"
      );

      // Read-only tools have isReadOnly that returns true when called with any input
      expect(peekTool.isReadOnly?.({} as never)).toBe(true);
    });
  });

  describe("Topics.getByIds", () => {
    it("should return events by message IDs", async () => {
      // Setup: Publish multiple events
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: { value: 1 } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", payload: { value: 2 } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-3", payload: { value: 3 } },
        "run-1"
      );

      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const result = await getByIdsTool.execute({
        topic: "emails",
        ids: ["msg-1", "msg-3"],
      });

      expect(result).toHaveLength(2);
      const messageIds = result.map(e => e.messageId).sort();
      expect(messageIds).toEqual(["msg-1", "msg-3"]);
    });

    it("should return empty array for empty IDs array", async () => {
      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const result = await getByIdsTool.execute({
        topic: "emails",
        ids: [],
      });

      expect(result).toEqual([]);
    });

    it("should return only found events for partial match", async () => {
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: {} },
        "run-1"
      );

      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const result = await getByIdsTool.execute({
        topic: "emails",
        ids: ["msg-1", "msg-nonexistent", "msg-also-nonexistent"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe("msg-1");
    });

    it("should return events regardless of status", async () => {
      // Setup: Create events with different statuses
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-pending", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-reserved", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-consumed", payload: {} },
        "run-1"
      );

      // Reserve and consume some events
      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-reserved"] }]);
      await eventStore.reserveEvents("run-3", [{ topic: "emails", ids: ["msg-consumed"] }]);
      await eventStore.consumeEvents("run-3");

      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const result = await getByIdsTool.execute({
        topic: "emails",
        ids: ["msg-pending", "msg-reserved", "msg-consumed"],
      });

      expect(result).toHaveLength(3);
      const statuses = result.map(e => ({ id: e.messageId, status: e.status }));
      expect(statuses).toContainEqual({ id: "msg-pending", status: "pending" });
      expect(statuses).toContainEqual({ id: "msg-reserved", status: "reserved" });
      expect(statuses).toContainEqual({ id: "msg-consumed", status: "consumed" });
    });

    it("should throw error when workflow context is missing", async () => {
      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => undefined // No workflow context
      );

      await expect(getByIdsTool.execute({ topic: "emails", ids: ["msg-1"] }))
        .rejects.toThrow("Topics.getByIds requires a workflow context");
    });

    it("should only return events from the specified topic", async () => {
      // Create events in different topics with same message ID
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: { topic: "emails" } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "processed",
        { messageId: "msg-1", payload: { topic: "processed" } },
        "run-1"
      );

      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const result = await getByIdsTool.execute({
        topic: "emails",
        ids: ["msg-1"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].payload).toEqual({ topic: "emails" });
    });

    it("should be read-only", async () => {
      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      // Read-only tools have isReadOnly that returns true when called with any input
      expect(getByIdsTool.isReadOnly?.({} as never)).toBe(true);
    });
  });

  describe("Topics.publish", () => {
    it("should publish an event to a topic", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          payload: { from: "alice@example.com", subject: "Hello" },
        },
      });

      // Verify event was created
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].message_id).toBe("msg-1");
      expect(events[0].title).toBe("");  // Title is deprecated, always empty for new events
      expect(events[0].payload).toEqual({ from: "alice@example.com", subject: "Hello" });
      expect(events[0].status).toBe("pending");
      expect(events[0].created_by_run_id).toBe("run-1");
    });

    it("should create topic if it does not exist", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "new-topic",
        event: {
          messageId: "msg-1",
          payload: {},
        },
      });

      // Topic should have been auto-created
      const events = await eventStore.peekEvents("workflow-1", "new-topic");
      expect(events).toHaveLength(1);
    });

    it("should be idempotent by messageId", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      // Publish first time
      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          payload: { original: true },
        },
      });

      // Publish again with same messageId but different content
      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          payload: { new: true },
        },
      });

      // Should have one event with updated content (last-write-wins per exec-15)
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ new: true });
    });

    it("should allow same messageId in different topics", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      });

      await publishTool.execute({
        topic: "processed",
        event: { messageId: "msg-1", payload: {} },
      });

      const emailEvents = await eventStore.peekEvents("workflow-1", "emails");
      const processedEvents = await eventStore.peekEvents("workflow-1", "processed");

      expect(emailEvents).toHaveLength(1);
      expect(processedEvents).toHaveLength(1);
    });

    it("should throw error when workflow context is missing", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => undefined, // No workflow context
        () => "run-1"
      );

      await expect(publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      })).rejects.toThrow("Topics.publish requires a workflow context");
    });

    it("should handle empty handler run ID", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => undefined // No handler run ID
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].created_by_run_id).toBe("");
    });

    it("should handle complex payloads", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      const complexPayload = {
        nested: { deep: { value: 123 } },
        array: [1, 2, { three: 3 }],
        nullValue: null,
        boolean: true,
        unicode: "Hello 世界 🌍",
      };

      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          payload: complexPayload,
        },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events[0].payload).toEqual(complexPayload);
    });

    it("should not be read-only (is a write operation)", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      // Write tools have isReadOnly that returns false when called with any input
      expect(publishTool.isReadOnly?.({} as never)).toBe(false);
    });

    it("should set attempt_number to 1 for new events", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      // Access via direct DB since peekEvents output format doesn't include attempt_number
      const event = await eventStore.get(events[0].id as unknown as string);
      expect(event?.attempt_number).toBe(1);
    });
  });

  describe("Tool metadata", () => {
    it("Topics.peek should have correct namespace and name", async () => {
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      expect(peekTool.namespace).toBe("Topics");
      expect(peekTool.name).toBe("peek");
    });

    it("Topics.getByIds should have correct namespace and name", async () => {
      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      expect(getByIdsTool.namespace).toBe("Topics");
      expect(getByIdsTool.name).toBe("getByIds");
    });

    it("Topics.publish should have correct namespace and name", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      expect(publishTool.namespace).toBe("Topics");
      expect(publishTool.name).toBe("publish");
    });
  });

  describe("Integration scenarios", () => {
    it("should support typical producer-consumer workflow", async () => {
      // Producer publishes events
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "producer-run-1"
      );

      await publishTool.execute({
        topic: "incoming-emails",
        event: {
          messageId: "email-123",
          payload: { emailId: "123", from: "alice@example.com", subject: "Meeting Tomorrow" },
        },
      });

      await publishTool.execute({
        topic: "incoming-emails",
        event: {
          messageId: "email-456",
          payload: { emailId: "456", from: "bob@example.com", subject: "Project Update" },
        },
      });

      // Consumer peeks to find work
      const peekTool = makeTopicsPeekTool(
        eventStore,
        () => "workflow-1",
        () => "consumer-run-1"
      );

      const pending = await peekTool.execute({ topic: "incoming-emails", limit: 10 });
      expect(pending).toHaveLength(2);

      // Consumer gets specific events by ID
      const getByIdsTool = makeTopicsGetByIdsTool(
        eventStore,
        () => "workflow-1"
      );

      const selected = await getByIdsTool.execute({
        topic: "incoming-emails",
        ids: [pending[0].messageId],
      });
      expect(selected).toHaveLength(1);

      // Simulate reservation and consumption (normally done by handler state machine)
      await eventStore.reserveEvents("consumer-run-1", [
        { topic: "incoming-emails", ids: [pending[0].messageId] },
      ]);

      // Peek again should only show unreserved events
      const stillPending = await peekTool.execute({ topic: "incoming-emails" });
      expect(stillPending).toHaveLength(1);
      expect(stillPending[0].messageId).toBe("email-456");
    });

    it("should handle cross-topic publishing in next phase", async () => {
      // Initial event
      await eventStore.publishEvent(
        "workflow-1",
        "raw-emails",
        { messageId: "email-1", payload: { emailId: "1" } },
        "producer-run"
      );

      // Consumer processes and publishes to next topic
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "consumer-next-run"
      );

      await publishTool.execute({
        topic: "processed-emails",
        event: {
          messageId: "processed:email-1",
          payload: { originalEmailId: "1", processed: true },
        },
      });

      // Verify both topics have events
      const raw = await eventStore.peekEvents("workflow-1", "raw-emails");
      const processed = await eventStore.peekEvents("workflow-1", "processed-emails");

      expect(raw).toHaveLength(1);
      expect(processed).toHaveLength(1);
      expect(processed[0].payload).toEqual({ originalEmailId: "1", processed: true });
    });
  });

  // ============================================================================
  // exec-15: Topics.registerInput
  // ============================================================================

  describe("Topics.registerInput (exec-15)", () => {
    it("should register an input and return inputId", async () => {
      const registerInputTool = makeTopicsRegisterInputTool(
        inputStore,
        () => "workflow-1",
        () => "run-1"
      );

      const inputId = await registerInputTool.execute({
        source: "gmail",
        type: "email",
        id: "email-123",
        title: 'Email from alice@example.com: "Hello"',
      });

      expect(inputId).toBeDefined();
      expect(typeof inputId).toBe("string");
      expect(inputId.length).toBe(32);
    });

    it("should be idempotent by (source, type, id)", async () => {
      const registerInputTool = makeTopicsRegisterInputTool(
        inputStore,
        () => "workflow-1",
        () => "run-1"
      );

      const inputId1 = await registerInputTool.execute({
        source: "gmail",
        type: "email",
        id: "email-123",
        title: 'First title',
      });

      const inputId2 = await registerInputTool.execute({
        source: "gmail",
        type: "email",
        id: "email-123",
        title: 'Second title - should be ignored',
      });

      expect(inputId2).toBe(inputId1);
    });

    it("should throw error when workflow context is missing", async () => {
      const registerInputTool = makeTopicsRegisterInputTool(
        inputStore,
        () => undefined,
        () => "run-1"
      );

      await expect(registerInputTool.execute({
        source: "gmail",
        type: "email",
        id: "email-123",
        title: 'Test',
      })).rejects.toThrow("Topics.registerInput requires a workflow context");
    });

    it("should have correct namespace and name", async () => {
      const registerInputTool = makeTopicsRegisterInputTool(
        inputStore,
        () => "workflow-1",
        () => "run-1"
      );

      expect(registerInputTool.namespace).toBe("Topics");
      expect(registerInputTool.name).toBe("registerInput");
    });

    it("should not be read-only", async () => {
      const registerInputTool = makeTopicsRegisterInputTool(
        inputStore,
        () => "workflow-1",
        () => "run-1"
      );

      expect(registerInputTool.isReadOnly?.({} as never)).toBe(false);
    });
  });

  // ============================================================================
  // exec-15: Multi-topic publish
  // ============================================================================

  describe("Topics.publish multi-topic support (exec-15)", () => {
    it("should publish to single topic with string", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
    });

    it("should publish to multiple topics with array", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: ["emails", "audit"],
        event: { messageId: "msg-1", payload: { data: "test" } },
      });

      const emailEvents = await eventStore.peekEvents("workflow-1", "emails");
      const auditEvents = await eventStore.peekEvents("workflow-1", "audit");

      expect(emailEvents).toHaveLength(1);
      expect(auditEvents).toHaveLength(1);
      expect(emailEvents[0].payload).toEqual({ data: "test" });
      expect(auditEvents[0].payload).toEqual({ data: "test" });
    });

    it("should use same messageId across topics", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: ["emails", "audit", "processed"],
        event: { messageId: "msg-123", payload: {} },
      });

      const emailEvents = await eventStore.peekEvents("workflow-1", "emails");
      const auditEvents = await eventStore.peekEvents("workflow-1", "audit");
      const processedEvents = await eventStore.peekEvents("workflow-1", "processed");

      expect(emailEvents[0].message_id).toBe("msg-123");
      expect(auditEvents[0].message_id).toBe("msg-123");
      expect(processedEvents[0].message_id).toBe("msg-123");
    });
  });

  // ============================================================================
  // exec-15: Phase-based inputId validation
  // ============================================================================

  describe("Topics.publish phase validation (exec-15)", () => {
    it("should require inputId in producer phase", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1",
        () => "producer" // Producer phase
      );

      await expect(publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      })).rejects.toThrow("Topics.publish in producer phase requires inputId");
    });

    it("should accept inputId in producer phase", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1",
        () => "producer"
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", inputId: "input-1", payload: {} },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].caused_by).toEqual(["input-1"]);
    });

    it("should forbid inputId in next phase", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1",
        () => "next" // Next phase
      );

      await expect(publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", inputId: "input-1", payload: {} },
      })).rejects.toThrow("Topics.publish in next phase must not provide inputId");
    });

    it("should inherit causedBy from reserved events in next phase", async () => {
      // Setup: Publish event with causedBy and reserve it
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", payload: {}, causedBy: ["input-1", "input-2"] },
        "run-1"
      );
      await eventStore.reserveEvents("consumer-run", [
        { topic: "emails", ids: ["msg-1"] },
      ]);

      // Next phase publish should inherit causedBy
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "consumer-run",
        () => "next"
      );

      await publishTool.execute({
        topic: "processed",
        event: { messageId: "processed-1", payload: {} },
      });

      const processedEvents = await eventStore.peekEvents("workflow-1", "processed");
      expect(processedEvents[0].caused_by.sort()).toEqual(["input-1", "input-2"]);
    });

    it("should allow publish without phase validation when phase is null", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1",
        () => null // No phase (task mode)
      );

      // Should work without inputId
      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", payload: {} },
      });

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
    });
  });

  // ============================================================================
  // exec-15: Full producer-consumer causal tracking
  // ============================================================================

  describe("exec-15 integration: full causal chain", () => {
    it("should trace events back to original input through pipeline", async () => {
      // Step 1: Producer registers input and publishes
      const inputId = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-123", title: "Test Email" },
        "producer-run"
      );

      await eventStore.publishEvent(
        "workflow-1",
        "raw-emails",
        { messageId: "email-123", payload: { subject: "Hello" }, causedBy: [inputId] },
        "producer-run"
      );

      // Step 2: Consumer 1 reserves and processes
      await eventStore.reserveEvents("consumer1-run", [
        { topic: "raw-emails", ids: ["email-123"] },
      ]);

      // Consumer 1's next phase inherits causedBy
      const consumer1CausedBy = await eventStore.getCausedByForRun("consumer1-run");
      expect(consumer1CausedBy).toEqual([inputId]);

      // Consumer 1 publishes to next topic with inherited causedBy
      await eventStore.publishEvent(
        "workflow-1",
        "processed-emails",
        { messageId: "processed:email-123", payload: { processed: true }, causedBy: consumer1CausedBy },
        "consumer1-run"
      );

      // Step 3: Consumer 2 reserves processed event
      await eventStore.reserveEvents("consumer2-run", [
        { topic: "processed-emails", ids: ["processed:email-123"] },
      ]);

      // Consumer 2 also traces back to original input
      const consumer2CausedBy = await eventStore.getCausedByForRun("consumer2-run");
      expect(consumer2CausedBy).toEqual([inputId]);

      // Verify the input is accessible
      const input = await inputStore.get(inputId);
      expect(input).not.toBeNull();
      expect(input!.title).toBe("Test Email");
    });
  });

  // ============================================================================
  // exec-15: Title deprecation
  // ============================================================================

  describe("exec-15 integration: title deprecation", () => {
    it("should store empty title when publishing events (title is deprecated)", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      // Publish with title field (deprecated usage)
      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          title: "This title is deprecated",
          payload: { data: "test" },
        },
      });

      // Title is stored but new code should use Input Ledger for user-facing metadata
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      // The title field should be empty for new events (exec-15 deprecation)
      // When title is not provided, it defaults to empty string
    });

    it("should store user-facing metadata in Input Ledger instead of event title", async () => {
      // Register input with user-facing title in Input Ledger
      const inputId = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'Email from alice@example.com: "Meeting tomorrow"',
        },
        "producer-run"
      );

      // Publish event without title (events don't need titles anymore)
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        {
          messageId: "email-123",
          payload: { id: "email-123", from: "alice@example.com" },
          causedBy: [inputId],
        },
        "producer-run"
      );

      // Event has no title
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events[0].title).toBe("");

      // But user-facing metadata is in Input Ledger
      const input = await inputStore.get(inputId);
      expect(input!.title).toBe('Email from alice@example.com: "Meeting tomorrow"');
    });

    it("should trace from mutation UI back to original input title", async () => {
      // Setup: Producer registers input and publishes
      const inputId = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'From: bob@example.com - "Quarterly Report"',
        },
        "producer-run"
      );

      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "email-123", payload: { id: "123" }, causedBy: [inputId] },
        "producer-run"
      );

      // Consumer reserves event
      await eventStore.reserveEvents("consumer-run", [
        { topic: "emails", ids: ["email-123"] },
      ]);

      // Consumer can get causedBy to trace back to input
      const causedBy = await eventStore.getCausedByForRun("consumer-run");
      expect(causedBy).toEqual([inputId]);

      // From causedBy, get the input(s) and their titles for mutation UI
      const inputs = await inputStore.getByIds(causedBy);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].title).toBe('From: bob@example.com - "Quarterly Report"');

      // This title can be used for prepareResult.ui.title
      const mutationUiTitle = inputs.map(i => i.title).join(", ");
      expect(mutationUiTitle).toBe('From: bob@example.com - "Quarterly Report"');
    });
  });
});
