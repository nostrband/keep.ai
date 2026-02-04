import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, EventStore, Event, EventStatus, TopicStore } from "@app/db";
import { createDBNode } from "@app/node";

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

describe("EventStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let eventStore: EventStore;
  let topicStore: TopicStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    eventStore = new EventStore(keepDb);
    topicStore = new TopicStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("publishEvent", () => {
    it("should publish an event to a topic", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "New Email", payload: { from: "test@example.com" } },
        "run-1"
      );

      expect(event).toBeDefined();
      expect(event.id).toBeDefined();
      expect(event.workflow_id).toBe("workflow-1");
      expect(event.message_id).toBe("msg-1");
      expect(event.title).toBe("New Email");
      expect(event.payload).toEqual({ from: "test@example.com" });
      expect(event.status).toBe("pending");
      expect(event.created_by_run_id).toBe("run-1");
      expect(event.attempt_number).toBe(1);
    });

    it("should create topic if it does not exist", async () => {
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      const topic = await topicStore.getByName("workflow-1", "emails");
      expect(topic).not.toBeNull();
    });

    it("should be idempotent by messageId", async () => {
      const event1 = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "First", payload: { a: 1 } },
        "run-1"
      );

      const event2 = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Second", payload: { b: 2 } },
        "run-2"
      );

      // Should return the original event
      expect(event2.id).toBe(event1.id);
      expect(event2.title).toBe("First");
      expect(event2.payload).toEqual({ a: 1 });
    });

    it("should allow same messageId in different topics", async () => {
      const event1 = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Email Event", payload: {} },
        "run-1"
      );

      const event2 = await eventStore.publishEvent(
        "workflow-1",
        "processed",
        { messageId: "msg-1", title: "Processed Event", payload: {} },
        "run-1"
      );

      expect(event1.id).not.toBe(event2.id);
    });
  });

  describe("get", () => {
    it("should return event by ID", async () => {
      const created = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: { data: "value" } },
        "run-1"
      );

      const event = await eventStore.get(created.id);

      expect(event).toEqual(created);
    });

    it("should return null for non-existent ID", async () => {
      const event = await eventStore.get("non-existent");
      expect(event).toBeNull();
    });
  });

  describe("getByMessageId", () => {
    it("should return event by topic ID and message ID", async () => {
      const created = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      const event = await eventStore.getByMessageId(created.topic_id, "msg-1");

      expect(event).toEqual(created);
    });

    it("should return null for non-existent message ID", async () => {
      const created = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      const event = await eventStore.getByMessageId(created.topic_id, "msg-2");
      expect(event).toBeNull();
    });
  });

  describe("peekEvents", () => {
    beforeEach(async () => {
      // Create multiple events
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Email 1", payload: {} },
        "run-1"
      );
      // Add small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-2", title: "Email 2", payload: {} },
        "run-1"
      );
      await new Promise(resolve => setTimeout(resolve, 10));
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-3", title: "Email 3", payload: {} },
        "run-1"
      );
    });

    it("should return pending events", async () => {
      const events = await eventStore.peekEvents("workflow-1", "emails");

      expect(events).toHaveLength(3);
      expect(events.every(e => e.status === "pending")).toBe(true);
    });

    it("should order events by created_at ASC", async () => {
      const events = await eventStore.peekEvents("workflow-1", "emails");

      expect(events[0].message_id).toBe("msg-1");
      expect(events[1].message_id).toBe("msg-2");
      expect(events[2].message_id).toBe("msg-3");
    });

    it("should respect limit option", async () => {
      const events = await eventStore.peekEvents("workflow-1", "emails", { limit: 2 });

      expect(events).toHaveLength(2);
    });

    it("should filter by status", async () => {
      // Reserve one event
      const events = await eventStore.peekEvents("workflow-1", "emails", { limit: 1 });
      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: [events[0].message_id] }]);

      const pending = await eventStore.peekEvents("workflow-1", "emails", { status: "pending" });
      const reserved = await eventStore.peekEvents("workflow-1", "emails", { status: "reserved" });

      expect(pending).toHaveLength(2);
      expect(reserved).toHaveLength(1);
    });

    it("should return empty array for non-existent topic", async () => {
      const events = await eventStore.peekEvents("workflow-1", "nonexistent");
      expect(events).toEqual([]);
    });
  });

  describe("getEventsByIds", () => {
    it("should return events by message IDs", async () => {
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
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-3", title: "Email 3", payload: {} },
        "run-1"
      );

      const events = await eventStore.getEventsByIds("workflow-1", "emails", ["msg-1", "msg-3"]);

      expect(events).toHaveLength(2);
      expect(events.map(e => e.message_id).sort()).toEqual(["msg-1", "msg-3"]);
    });

    it("should return empty array for empty IDs", async () => {
      const events = await eventStore.getEventsByIds("workflow-1", "emails", []);
      expect(events).toEqual([]);
    });
  });

  describe("reserveEvents", () => {
    it("should reserve pending events", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);

      const reserved = await eventStore.get(event.id);
      expect(reserved?.status).toBe("reserved");
      expect(reserved?.reserved_by_run_id).toBe("run-2");
    });

    it("should only reserve pending events", async () => {
      await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      // Reserve once
      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);

      // Try to reserve again
      await eventStore.reserveEvents("run-3", [{ topic: "emails", ids: ["msg-1"] }]);

      const events = await eventStore.peekEvents("workflow-1", "emails", { status: "reserved" });
      // Should still be reserved by run-2
      expect(events[0].reserved_by_run_id).toBe("run-2");
    });

    it("should handle multiple reservations", async () => {
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");

      await eventStore.reserveEvents("run-2", [
        { topic: "emails", ids: ["msg-1", "msg-2"] }
      ]);

      const reserved = await eventStore.getReservedByRun("run-2");
      expect(reserved).toHaveLength(2);
    });
  });

  describe("consumeEvents", () => {
    it("should consume reserved events", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);
      await eventStore.consumeEvents("run-2");

      const consumed = await eventStore.get(event.id);
      expect(consumed?.status).toBe("consumed");
    });

    it("should only consume events reserved by the same run", async () => {
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);
      await eventStore.reserveEvents("run-3", [{ topic: "emails", ids: ["msg-2"] }]);

      await eventStore.consumeEvents("run-2");

      const reserved = await eventStore.peekEvents("workflow-1", "emails", { status: "reserved" });
      expect(reserved).toHaveLength(1);
      expect(reserved[0].message_id).toBe("msg-2");
    });
  });

  describe("skipEvents", () => {
    it("should skip reserved events", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);
      await eventStore.skipEvents("run-2");

      const skipped = await eventStore.get(event.id);
      expect(skipped?.status).toBe("skipped");
    });
  });

  describe("releaseEvents", () => {
    it("should release reserved events back to pending", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);
      await eventStore.releaseEvents("run-2");

      const released = await eventStore.get(event.id);
      expect(released?.status).toBe("pending");
      expect(released?.reserved_by_run_id).toBe("");
    });

    it("should increment attempt_number on release", async () => {
      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "run-1"
      );

      expect(event.attempt_number).toBe(1);

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);
      await eventStore.releaseEvents("run-2");

      const released = await eventStore.get(event.id);
      expect(released?.attempt_number).toBe(2);
    });
  });

  describe("countPending", () => {
    it("should count pending events for a topic", async () => {
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-3", title: "Test 3", payload: {} }, "run-1");

      // Reserve one
      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1"] }]);

      const count = await eventStore.countPending("workflow-1", "emails");
      expect(count).toBe(2);
    });

    it("should return 0 for non-existent topic", async () => {
      const count = await eventStore.countPending("workflow-1", "nonexistent");
      expect(count).toBe(0);
    });
  });

  describe("getReservedByRun", () => {
    it("should return events reserved by a run", async () => {
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");

      await eventStore.reserveEvents("run-2", [{ topic: "emails", ids: ["msg-1", "msg-2"] }]);

      const reserved = await eventStore.getReservedByRun("run-2");
      expect(reserved).toHaveLength(2);
    });

    it("should return empty array for non-existent run", async () => {
      const reserved = await eventStore.getReservedByRun("non-existent");
      expect(reserved).toEqual([]);
    });
  });

  describe("deleteByTopic", () => {
    it("should delete all events for a topic", async () => {
      const topic = await topicStore.create("workflow-1", "emails");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");

      await eventStore.deleteByTopic(topic.id);

      const events = await eventStore.peekEvents("workflow-1", "emails");
      expect(events).toHaveLength(0);
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete all events for a workflow", async () => {
      await eventStore.publishEvent("workflow-1", "emails", { messageId: "msg-1", title: "Test 1", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-1", "processed", { messageId: "msg-2", title: "Test 2", payload: {} }, "run-1");
      await eventStore.publishEvent("workflow-2", "emails", { messageId: "msg-3", title: "Test 3", payload: {} }, "run-1");

      await eventStore.deleteByWorkflow("workflow-1");

      const events1 = await eventStore.peekEvents("workflow-1", "emails");
      const events2 = await eventStore.peekEvents("workflow-1", "processed");
      const events3 = await eventStore.peekEvents("workflow-2", "emails");

      expect(events1).toHaveLength(0);
      expect(events2).toHaveLength(0);
      expect(events3).toHaveLength(1);
    });
  });

  describe("JSON payload handling", () => {
    it("should serialize and deserialize complex payloads", async () => {
      const complexPayload = {
        nested: { deep: { value: 123 } },
        array: [1, 2, { three: 3 }],
        null: null,
        boolean: true,
      };

      const event = await eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: complexPayload },
        "run-1"
      );

      const retrieved = await eventStore.get(event.id);
      expect(retrieved?.payload).toEqual(complexPayload);
    });
  });
});
