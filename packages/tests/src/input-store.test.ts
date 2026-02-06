import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, InputStore, Input } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create inputs table without full migration system.
 * Schema matches packages/db/src/migrations/v44.ts
 */
async function createTables(db: DBInterface): Promise<void> {
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

describe("InputStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let inputStore: InputStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    inputStore = new InputStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("register", () => {
    it("should register a new input and return inputId", async () => {
      const inputId = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'Email from alice@example.com: "Hello"',
        },
        "run-1"
      );

      expect(inputId).toBeDefined();
      expect(typeof inputId).toBe("string");
      expect(inputId.length).toBe(32); // 16 bytes hex encoded
    });

    it("should return existing inputId for duplicate registration", async () => {
      const inputId1 = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'Email from alice@example.com: "Hello"',
        },
        "run-1"
      );

      const inputId2 = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'Different title - should be ignored',
        },
        "run-2"
      );

      expect(inputId2).toBe(inputId1);
    });

    it("should create separate entries for different external_ids", async () => {
      const inputId1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-123", title: "Email 1" },
        "run-1"
      );

      const inputId2 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-456", title: "Email 2" },
        "run-1"
      );

      expect(inputId1).not.toBe(inputId2);
    });

    it("should create separate entries for different workflows", async () => {
      const inputId1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-123", title: "Email" },
        "run-1"
      );

      const inputId2 = await inputStore.register(
        "workflow-2",
        { source: "gmail", type: "email", id: "email-123", title: "Email" },
        "run-1"
      );

      expect(inputId1).not.toBe(inputId2);
    });

    it("should create separate entries for different sources", async () => {
      const inputId1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "msg-123", title: "Message" },
        "run-1"
      );

      const inputId2 = await inputStore.register(
        "workflow-1",
        { source: "slack", type: "email", id: "msg-123", title: "Message" },
        "run-1"
      );

      expect(inputId1).not.toBe(inputId2);
    });

    it("should create separate entries for different types", async () => {
      const inputId1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "item-123", title: "Item" },
        "run-1"
      );

      const inputId2 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "draft", id: "item-123", title: "Item" },
        "run-1"
      );

      expect(inputId1).not.toBe(inputId2);
    });
  });

  describe("get", () => {
    it("should return input by ID", async () => {
      const inputId = await inputStore.register(
        "workflow-1",
        {
          source: "gmail",
          type: "email",
          id: "email-123",
          title: 'Email from alice@example.com: "Hello"',
        },
        "run-1"
      );

      const input = await inputStore.get(inputId);

      expect(input).not.toBeNull();
      expect(input!.id).toBe(inputId);
      expect(input!.workflow_id).toBe("workflow-1");
      expect(input!.source).toBe("gmail");
      expect(input!.type).toBe("email");
      expect(input!.external_id).toBe("email-123");
      expect(input!.title).toBe('Email from alice@example.com: "Hello"');
      expect(input!.created_by_run_id).toBe("run-1");
      expect(input!.created_at).toBeGreaterThan(0);
    });

    it("should return null for non-existent ID", async () => {
      const input = await inputStore.get("non-existent-id");
      expect(input).toBeNull();
    });
  });

  describe("getByWorkflow", () => {
    it("should return all inputs for a workflow", async () => {
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-1", title: "Email 1" },
        "run-1"
      );
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-2", title: "Email 2" },
        "run-1"
      );
      await inputStore.register(
        "workflow-2",
        { source: "gmail", type: "email", id: "email-3", title: "Email 3" },
        "run-1"
      );

      const inputs = await inputStore.getByWorkflow("workflow-1");

      expect(inputs).toHaveLength(2);
      expect(inputs.map((i) => i.external_id).sort()).toEqual(["email-1", "email-2"]);
    });

    it("should return empty array for workflow with no inputs", async () => {
      const inputs = await inputStore.getByWorkflow("workflow-1");
      expect(inputs).toEqual([]);
    });

    it("should order by created_at descending", async () => {
      // Register inputs with some delay to ensure different timestamps
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-1", title: "Email 1" },
        "run-1"
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-2", title: "Email 2" },
        "run-1"
      );

      const inputs = await inputStore.getByWorkflow("workflow-1");

      // Most recent first
      expect(inputs[0].external_id).toBe("email-2");
      expect(inputs[1].external_id).toBe("email-1");
    });
  });

  describe("getByIds", () => {
    it("should return inputs by IDs", async () => {
      const id1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-1", title: "Email 1" },
        "run-1"
      );
      const id2 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-2", title: "Email 2" },
        "run-1"
      );
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-3", title: "Email 3" },
        "run-1"
      );

      const inputs = await inputStore.getByIds([id1, id2]);

      expect(inputs).toHaveLength(2);
      expect(inputs.map((i) => i.id).sort()).toEqual([id1, id2].sort());
    });

    it("should return empty array for empty IDs", async () => {
      const inputs = await inputStore.getByIds([]);
      expect(inputs).toEqual([]);
    });

    it("should ignore non-existent IDs", async () => {
      const id1 = await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-1", title: "Email 1" },
        "run-1"
      );

      const inputs = await inputStore.getByIds([id1, "non-existent"]);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].id).toBe(id1);
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete all inputs for a workflow", async () => {
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-1", title: "Email 1" },
        "run-1"
      );
      await inputStore.register(
        "workflow-1",
        { source: "gmail", type: "email", id: "email-2", title: "Email 2" },
        "run-1"
      );
      await inputStore.register(
        "workflow-2",
        { source: "gmail", type: "email", id: "email-3", title: "Email 3" },
        "run-1"
      );

      await inputStore.deleteByWorkflow("workflow-1");

      const workflow1Inputs = await inputStore.getByWorkflow("workflow-1");
      const workflow2Inputs = await inputStore.getByWorkflow("workflow-2");

      expect(workflow1Inputs).toEqual([]);
      expect(workflow2Inputs).toHaveLength(1);
    });
  });
});
