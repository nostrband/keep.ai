import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, EventStore } from "@app/db";
import { createDBNode } from "@app/node";
import {
  makeTopicsPeekTool,
  makeTopicsGetByIdsTool,
  makeTopicsPublishTool,
} from "@app/agent";

/**
 * Helper to create topics and events tables without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts
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
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(topic_id, message_id)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_reserved_by ON events(reserved_by_run_id)`);
}

describe("Topics API Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let eventStore: EventStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    eventStore = new EventStore(keepDb);
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
        { messageId: "msg-1", title: "Email 1", payload: { from: "alice@example.com" } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", title: "Email 2", payload: { from: "bob@example.com" } },
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
      expect(result[0].title).toBe("Email 1");
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
          { messageId: `msg-${i}`, title: `Email ${i}`, payload: {} },
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
        { messageId: "msg-1", title: "Email 1", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", title: "Email 2", payload: {} },
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
          { messageId: `msg-${i}`, title: `Email ${i}`, payload: {} },
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
        { messageId: "msg-c", title: "Third", payload: {} },
        "run-1"
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-a", title: "Fourth", payload: {} },
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
        { messageId: "msg-1", title: "Email 1", payload: { value: 1 } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", title: "Email 2", payload: { value: 2 } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-3", title: "Email 3", payload: { value: 3 } },
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
        { messageId: "msg-1", title: "Email 1", payload: {} },
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
        { messageId: "msg-pending", title: "Pending", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-reserved", title: "Reserved", payload: {} },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-consumed", title: "Consumed", payload: {} },
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
        { messageId: "msg-1", title: "In Emails", payload: { topic: "emails" } },
        "run-1"
      );
      await eventStore.publishEvent(
        "workflow-1",
        "processed",
        { messageId: "msg-1", title: "In Processed", payload: { topic: "processed" } },
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
          title: "New Email from Alice",
          payload: { from: "alice@example.com", subject: "Hello" },
        },
      });

      // Verify event was created
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].message_id).toBe("msg-1");
      expect(events[0].title).toBe("New Email from Alice");
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
          title: "First Event",
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
          title: "Original Title",
          payload: { original: true },
        },
      });

      // Publish again with same messageId but different content
      await publishTool.execute({
        topic: "emails",
        event: {
          messageId: "msg-1",
          title: "New Title",
          payload: { new: true },
        },
      });

      // Should only have one event with original content
      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe("Original Title");
      expect(events[0].payload).toEqual({ original: true });
    });

    it("should allow same messageId in different topics", async () => {
      const publishTool = makeTopicsPublishTool(
        eventStore,
        () => "workflow-1",
        () => "run-1"
      );

      await publishTool.execute({
        topic: "emails",
        event: { messageId: "msg-1", title: "In Emails", payload: {} },
      });

      await publishTool.execute({
        topic: "processed",
        event: { messageId: "msg-1", title: "In Processed", payload: {} },
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
        event: { messageId: "msg-1", title: "Test", payload: {} },
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
        event: { messageId: "msg-1", title: "Test", payload: {} },
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
          title: "Complex Payload",
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
        event: { messageId: "msg-1", title: "Test", payload: {} },
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
          title: "Email from alice@example.com: Meeting Tomorrow",
          payload: { emailId: "123", from: "alice@example.com", subject: "Meeting Tomorrow" },
        },
      });

      await publishTool.execute({
        topic: "incoming-emails",
        event: {
          messageId: "email-456",
          title: "Email from bob@example.com: Project Update",
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
        { messageId: "email-1", title: "Raw Email", payload: { emailId: "1" } },
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
          title: "Processed: Raw Email",
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
});
