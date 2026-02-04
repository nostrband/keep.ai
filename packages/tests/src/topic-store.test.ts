import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, TopicStore, Topic } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create topics table without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts
 */
async function createTopicsTable(db: DBInterface): Promise<void> {
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
}

describe("TopicStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let topicStore: TopicStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTopicsTable(db);
    topicStore = new TopicStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("create", () => {
    it("should create a topic", async () => {
      const topic = await topicStore.create("workflow-1", "emails");

      expect(topic).toBeDefined();
      expect(topic.id).toBeDefined();
      expect(topic.workflow_id).toBe("workflow-1");
      expect(topic.name).toBe("emails");
      expect(topic.created_at).toBeGreaterThan(0);
    });

    it("should generate unique IDs for different topics", async () => {
      const topic1 = await topicStore.create("workflow-1", "emails");
      const topic2 = await topicStore.create("workflow-1", "processed");

      expect(topic1.id).not.toBe(topic2.id);
    });

    it("should throw error for duplicate topic name in same workflow", async () => {
      await topicStore.create("workflow-1", "emails");

      await expect(topicStore.create("workflow-1", "emails"))
        .rejects.toThrow();
    });

    it("should allow same topic name in different workflows", async () => {
      const topic1 = await topicStore.create("workflow-1", "emails");
      const topic2 = await topicStore.create("workflow-2", "emails");

      expect(topic1.id).not.toBe(topic2.id);
      expect(topic1.workflow_id).toBe("workflow-1");
      expect(topic2.workflow_id).toBe("workflow-2");
    });
  });

  describe("get", () => {
    it("should return topic by ID", async () => {
      const created = await topicStore.create("workflow-1", "emails");
      const topic = await topicStore.get(created.id);

      expect(topic).toEqual(created);
    });

    it("should return null for non-existent ID", async () => {
      const topic = await topicStore.get("non-existent");
      expect(topic).toBeNull();
    });
  });

  describe("getByName", () => {
    it("should return topic by workflow ID and name", async () => {
      const created = await topicStore.create("workflow-1", "emails");
      const topic = await topicStore.getByName("workflow-1", "emails");

      expect(topic).toEqual(created);
    });

    it("should return null for non-existent name", async () => {
      await topicStore.create("workflow-1", "emails");
      const topic = await topicStore.getByName("workflow-1", "other");

      expect(topic).toBeNull();
    });

    it("should return null for wrong workflow ID", async () => {
      await topicStore.create("workflow-1", "emails");
      const topic = await topicStore.getByName("workflow-2", "emails");

      expect(topic).toBeNull();
    });
  });

  describe("getOrCreate", () => {
    it("should create topic if it does not exist", async () => {
      const topic = await topicStore.getOrCreate("workflow-1", "emails");

      expect(topic).toBeDefined();
      expect(topic.workflow_id).toBe("workflow-1");
      expect(topic.name).toBe("emails");
    });

    it("should return existing topic if it exists", async () => {
      const created = await topicStore.create("workflow-1", "emails");
      const topic = await topicStore.getOrCreate("workflow-1", "emails");

      expect(topic.id).toBe(created.id);
      expect(topic.created_at).toBe(created.created_at);
    });

    it("should be idempotent", async () => {
      const topic1 = await topicStore.getOrCreate("workflow-1", "emails");
      const topic2 = await topicStore.getOrCreate("workflow-1", "emails");

      expect(topic1.id).toBe(topic2.id);
    });
  });

  describe("list", () => {
    it("should list topics for a workflow", async () => {
      await topicStore.create("workflow-1", "emails");
      await topicStore.create("workflow-1", "processed");
      await topicStore.create("workflow-2", "other");

      const topics = await topicStore.list("workflow-1");

      expect(topics).toHaveLength(2);
      expect(topics.map(t => t.name).sort()).toEqual(["emails", "processed"]);
    });

    it("should return empty array for workflow with no topics", async () => {
      const topics = await topicStore.list("workflow-1");
      expect(topics).toEqual([]);
    });

    it("should order topics by name", async () => {
      await topicStore.create("workflow-1", "zebra");
      await topicStore.create("workflow-1", "alpha");
      await topicStore.create("workflow-1", "beta");

      const topics = await topicStore.list("workflow-1");

      expect(topics.map(t => t.name)).toEqual(["alpha", "beta", "zebra"]);
    });

    it("should respect limit option", async () => {
      await topicStore.create("workflow-1", "alpha");
      await topicStore.create("workflow-1", "beta");
      await topicStore.create("workflow-1", "gamma");

      const topics = await topicStore.list("workflow-1", { limit: 2 });

      expect(topics).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("should delete topic by ID", async () => {
      const topic = await topicStore.create("workflow-1", "emails");
      await topicStore.delete(topic.id);

      const result = await topicStore.get(topic.id);
      expect(result).toBeNull();
    });

    it("should not throw for non-existent ID", async () => {
      await expect(topicStore.delete("non-existent")).resolves.not.toThrow();
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete all topics for a workflow", async () => {
      await topicStore.create("workflow-1", "emails");
      await topicStore.create("workflow-1", "processed");
      await topicStore.create("workflow-2", "other");

      await topicStore.deleteByWorkflow("workflow-1");

      const topics1 = await topicStore.list("workflow-1");
      const topics2 = await topicStore.list("workflow-2");

      expect(topics1).toHaveLength(0);
      expect(topics2).toHaveLength(1);
    });
  });
});
