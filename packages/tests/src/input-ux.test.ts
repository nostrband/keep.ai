/**
 * Tests for exec-16 Input/Output UX functionality.
 *
 * Tests:
 * - Input status computation (pending/done based on event state)
 * - Input statistics aggregation
 * - Stale input detection
 * - Needs attention count
 * - Mutations by input tracing
 * - Events by input lookup
 * - Output statistics aggregation
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import {
  DBInterface,
  KeepDb,
  InputStore,
  EventStore,
  MutationStore,
  HandlerRunStore,
} from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create tables for testing.
 */
async function createTables(db: DBInterface): Promise<void> {
  // Topics table
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

  // Events table
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

  // Inputs table
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

  // Handler runs table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS handler_runs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      script_run_id TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      handler_type TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'active',
      retry_of TEXT NOT NULL DEFAULT '',
      prepare_result TEXT NOT NULL DEFAULT '',
      input_state TEXT NOT NULL DEFAULT '{}',
      output_state TEXT NOT NULL DEFAULT '{}',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_workflow ON handler_runs(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_status ON handler_runs(status)`);

  // Mutations table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mutations (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      handler_run_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      tool_namespace TEXT NOT NULL DEFAULT '',
      tool_method TEXT NOT NULL DEFAULT '',
      params TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      last_reconcile_at INTEGER NOT NULL DEFAULT 0,
      next_reconcile_at INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER NOT NULL DEFAULT 0,
      ui_title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_workflow ON mutations(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_handler_run ON mutations(handler_run_id)`);
}

describe("exec-16: Input/Output UX", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let inputStore: InputStore;
  let eventStore: EventStore;
  let mutationStore: MutationStore;
  let handlerRunStore: HandlerRunStore;
  const workflowId = "test-workflow-" + bytesToHex(randomBytes(8));

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    inputStore = new InputStore(keepDb);
    eventStore = new EventStore(keepDb);
    mutationStore = new MutationStore(keepDb);
    handlerRunStore = new HandlerRunStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Input Status Computation", () => {
    it("should return 'pending' status for input with no events", async () => {
      // Register input with no events (producer registered but hasn't published yet)
      const inputId = await inputStore.register(workflowId, {
        source: "gmail",
        type: "email",
        id: "ext-1",
        title: "Test email 1",
      }, "producer-run-1");

      const inputs = await inputStore.getByWorkflowWithStatus(workflowId);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].id).toBe(inputId);
      expect(inputs[0].status).toBe("pending"); // No events = pending (producer may have failed)
    });

    it("should return 'pending' status for input with pending events", async () => {
      // Register input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail",
        type: "email",
        id: "ext-2",
        title: "Test email 2",
      }, "producer-run-1");

      // Create an event with caused_by pointing to this input
      await eventStore.publishEvent(
        workflowId,
        "test-topic",
        {
          messageId: "msg-1",
          payload: { data: "test" },
          causedBy: [inputId],
        },
        "producer-run-1"
      );

      const inputs = await inputStore.getByWorkflowWithStatus(workflowId);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].status).toBe("pending"); // Has pending event
    });

    it("should return 'done' status for input with consumed events", async () => {
      // Register input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail",
        type: "email",
        id: "ext-3",
        title: "Test email 3",
      }, "producer-run-1");

      // Create and consume an event
      const event = await eventStore.publishEvent(
        workflowId,
        "test-topic",
        {
          messageId: "msg-2",
          payload: { data: "test" },
          causedBy: [inputId],
        },
        "producer-run-1"
      );

      // Reserve and consume the event
      await eventStore.reserveEvents("handler-run-1", [
        { topic: "test-topic", ids: ["msg-2"] }
      ]);
      await eventStore.consumeEvents("handler-run-1");

      const inputs = await inputStore.getByWorkflowWithStatus(workflowId);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].status).toBe("done"); // All events consumed
    });

    it("should return 'pending' status for input with reserved events", async () => {
      // Register input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail",
        type: "email",
        id: "ext-4",
        title: "Test email 4",
      }, "producer-run-1");

      // Create and reserve an event (but don't consume)
      await eventStore.publishEvent(
        workflowId,
        "test-topic",
        {
          messageId: "msg-3",
          payload: { data: "test" },
          causedBy: [inputId],
        },
        "producer-run-1"
      );
      await eventStore.reserveEvents("handler-run-2", [
        { topic: "test-topic", ids: ["msg-3"] }
      ]);

      const inputs = await inputStore.getByWorkflowWithStatus(workflowId);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].status).toBe("pending"); // Reserved = still in progress
    });

    it("should handle multiple events for same input correctly", async () => {
      // Register input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail",
        type: "email",
        id: "ext-5",
        title: "Test email 5",
      }, "producer-run-1");

      // Create multiple events
      await eventStore.publishEvent(
        workflowId,
        "test-topic",
        { messageId: "msg-4", payload: {}, causedBy: [inputId] },
        "producer-run-1"
      );
      await eventStore.publishEvent(
        workflowId,
        "test-topic",
        { messageId: "msg-5", payload: {}, causedBy: [inputId] },
        "producer-run-1"
      );

      // Consume only one event
      await eventStore.reserveEvents("handler-run-3", [
        { topic: "test-topic", ids: ["msg-4"] }
      ]);
      await eventStore.consumeEvents("handler-run-3");

      const inputs = await inputStore.getByWorkflowWithStatus(workflowId);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].status).toBe("pending"); // One event still pending
    });
  });

  describe("Input Statistics", () => {
    it("should aggregate input counts by source and type", async () => {
      // Register multiple inputs with different sources/types
      await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "e1", title: "Email 1"
      }, "r1");
      await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "e2", title: "Email 2"
      }, "r1");
      await inputStore.register(workflowId, {
        source: "slack", type: "message", id: "m1", title: "Message 1"
      }, "r1");

      const stats = await inputStore.getStatsByWorkflow(workflowId);

      expect(stats).toHaveLength(2);

      const gmailStats = stats.find(s => s.source === "gmail" && s.type === "email");
      expect(gmailStats).toBeDefined();
      expect(gmailStats!.total_count).toBe(2);
      expect(gmailStats!.pending_count).toBe(2); // No events = pending

      const slackStats = stats.find(s => s.source === "slack" && s.type === "message");
      expect(slackStats).toBeDefined();
      expect(slackStats!.total_count).toBe(1);
    });

    it("should correctly count pending and done inputs", async () => {
      // Create two inputs
      const input1 = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "e3", title: "Email 3"
      }, "r1");
      const input2 = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "e4", title: "Email 4"
      }, "r1");

      // Create pending event for input1 only
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "m1", payload: {}, causedBy: [input1] },
        "r1"
      );

      const stats = await inputStore.getStatsByWorkflow(workflowId);
      const gmailStats = stats.find(s => s.source === "gmail");

      expect(gmailStats).toBeDefined();
      expect(gmailStats!.pending_count).toBe(2); // input1 has pending event, input2 has no events (both pending)
      expect(gmailStats!.done_count).toBe(0);
      expect(gmailStats!.total_count).toBe(2);
    });
  });

  describe("Stale Input Detection", () => {
    it("should detect stale pending inputs", async () => {
      // Register input with old timestamp (simulate stale input)
      const inputId = bytesToHex(randomBytes(16));
      const staleTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago

      // Insert directly to control timestamp
      await db.exec(
        `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [inputId, workflowId, "gmail", "email", "stale-1", "Stale email", "r1", staleTime]
      );

      // Create pending event
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "stale-msg", payload: {}, causedBy: [inputId] },
        "r1"
      );

      const staleInputs = await inputStore.getStaleInputs(workflowId, 7 * 24 * 60 * 60 * 1000);

      expect(staleInputs).toHaveLength(1);
      expect(staleInputs[0].id).toBe(inputId);
      expect(staleInputs[0].status).toBe("pending");
    });

    it("should not include recent pending inputs in stale list", async () => {
      // Register fresh input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "fresh-1", title: "Fresh email"
      }, "r1");

      // Create pending event
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "fresh-msg", payload: {}, causedBy: [inputId] },
        "r1"
      );

      const staleInputs = await inputStore.getStaleInputs(workflowId, 7 * 24 * 60 * 60 * 1000);

      expect(staleInputs).toHaveLength(0);
    });

    it("should not include completed inputs in stale list even if old", async () => {
      // Create old input with all events consumed (truly done)
      const inputId = bytesToHex(randomBytes(16));
      const staleTime = Date.now() - (8 * 24 * 60 * 60 * 1000);

      await db.exec(
        `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [inputId, workflowId, "gmail", "email", "old-done", "Old done email", "r1", staleTime]
      );

      // Create and consume an event so the input is truly done
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "old-done-msg", payload: {}, causedBy: [inputId] },
        "r1"
      );
      await eventStore.reserveEvents("hr-old-done", [{ topic: "topic1", ids: ["old-done-msg"] }]);
      await eventStore.consumeEvents("hr-old-done");

      const staleInputs = await inputStore.getStaleInputs(workflowId);

      expect(staleInputs).toHaveLength(0);
    });
  });

  describe("Needs Attention Count", () => {
    it("should count stale inputs as needing attention", async () => {
      // Create stale pending input
      const inputId = bytesToHex(randomBytes(16));
      const staleTime = Date.now() - (8 * 24 * 60 * 60 * 1000);

      await db.exec(
        `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [inputId, workflowId, "gmail", "email", "attention-1", "Attention email", "r1", staleTime]
      );

      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "attention-msg", payload: {}, causedBy: [inputId] },
        "r1"
      );

      const count = await inputStore.countNeedsAttention(workflowId);

      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Mutations by Input", () => {
    it("should return mutations caused by an input", async () => {
      // Register input
      const inputId = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "mut-1", title: "Email for mutation"
      }, "r1");

      // Create event with caused_by
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "mut-msg", payload: {}, causedBy: [inputId] },
        "r1"
      );

      // Reserve event and create handler run
      await eventStore.reserveEvents("handler-run-mut", [
        { topic: "topic1", ids: ["mut-msg"] }
      ]);

      // Create handler run
      const handlerRun = await handlerRunStore.create({
        script_run_id: "test-script-run",
        handler_name: "test-handler",
        handler_type: "consumer",
        workflow_id: workflowId,
      });

      // Manually update reserved_by_run_id to match our handler run
      await db.exec(
        `UPDATE events SET reserved_by_run_id = ? WHERE message_id = ?`,
        [handlerRun.id, "mut-msg"]
      );

      // Create mutation for this handler run
      const mutation = await mutationStore.create({
        handler_run_id: handlerRun.id,
        workflow_id: workflowId,
        ui_title: "Send notification",
      });

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "slack",
        tool_method: "sendMessage",
        params: JSON.stringify({ channel: "#test" }),
      });

      await mutationStore.markApplied(mutation.id, JSON.stringify({ ok: true }));

      // Query mutations by input
      const mutations = await mutationStore.getByInputId(inputId);

      expect(mutations).toHaveLength(1);
      expect(mutations[0].ui_title).toBe("Send notification");
      expect(mutations[0].status).toBe("applied");
    });

    it("should return empty array for input with no mutations", async () => {
      const inputId = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "no-mut", title: "No mutations"
      }, "r1");

      const mutations = await mutationStore.getByInputId(inputId);

      expect(mutations).toHaveLength(0);
    });
  });

  describe("Events by Input", () => {
    it("should return events referencing an input", async () => {
      const inputId = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "ev-1", title: "Email events"
      }, "r1");

      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "ev-msg-1", payload: { seq: 1 }, causedBy: [inputId] },
        "r1"
      );
      await eventStore.publishEvent(
        workflowId,
        "topic2",
        { messageId: "ev-msg-2", payload: { seq: 2 }, causedBy: [inputId] },
        "r1"
      );

      const events = await eventStore.getByInputId(inputId);

      expect(events).toHaveLength(2);
      expect(events.every(e => e.caused_by.includes(inputId))).toBe(true);
    });

    it("should filter events by status", async () => {
      const inputId = await inputStore.register(workflowId, {
        source: "gmail", type: "email", id: "ev-2", title: "Filtered events"
      }, "r1");

      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "pending-ev", payload: {}, causedBy: [inputId] },
        "r1"
      );
      await eventStore.publishEvent(
        workflowId,
        "topic1",
        { messageId: "consumed-ev", payload: {}, causedBy: [inputId] },
        "r1"
      );

      // Consume one event
      await eventStore.reserveEvents("hr1", [{ topic: "topic1", ids: ["consumed-ev"] }]);
      await eventStore.consumeEvents("hr1");

      const pendingEvents = await eventStore.getByInputId(inputId, { status: ["pending"] });
      expect(pendingEvents).toHaveLength(1);
      expect(pendingEvents[0].message_id).toBe("pending-ev");

      const consumedEvents = await eventStore.getByInputId(inputId, { status: ["consumed"] });
      expect(consumedEvents).toHaveLength(1);
      expect(consumedEvents[0].message_id).toBe("consumed-ev");
    });
  });

  describe("Output Statistics", () => {
    it("should aggregate mutation counts by connector", async () => {
      // Create mutations for different connectors
      const run1 = await handlerRunStore.create({
        script_run_id: "test-script-run-1",
        handler_name: "h1",
        handler_type: "consumer",
        workflow_id: workflowId,
      });
      const run2 = await handlerRunStore.create({
        script_run_id: "test-script-run-2",
        handler_name: "h2",
        handler_type: "consumer",
        workflow_id: workflowId,
      });
      const run3 = await handlerRunStore.create({
        script_run_id: "test-script-run-3",
        handler_name: "h3",
        handler_type: "consumer",
        workflow_id: workflowId,
      });

      const m1 = await mutationStore.create({ handler_run_id: run1.id, workflow_id: workflowId });
      await mutationStore.markInFlight(m1.id, {
        tool_namespace: "slack",
        tool_method: "sendMessage",
        params: "{}",
      });
      await mutationStore.markApplied(m1.id, "{}");

      const m2 = await mutationStore.create({ handler_run_id: run2.id, workflow_id: workflowId });
      await mutationStore.markInFlight(m2.id, {
        tool_namespace: "slack",
        tool_method: "sendMessage",
        params: "{}",
      });
      await mutationStore.markApplied(m2.id, "{}");

      const m3 = await mutationStore.create({ handler_run_id: run3.id, workflow_id: workflowId });
      await mutationStore.markInFlight(m3.id, {
        tool_namespace: "sheets",
        tool_method: "appendRow",
        params: "{}",
      });
      await mutationStore.markFailed(m3.id, "Error");

      const stats = await mutationStore.getOutputStatsByWorkflow(workflowId);

      expect(stats).toHaveLength(2);

      const slackStats = stats.find(s => s.tool_namespace === "slack");
      expect(slackStats).toBeDefined();
      expect(slackStats!.applied_count).toBe(2);
      expect(slackStats!.total_count).toBe(2);

      const sheetsStats = stats.find(s => s.tool_namespace === "sheets");
      expect(sheetsStats).toBeDefined();
      expect(sheetsStats!.failed_count).toBe(1);
      expect(sheetsStats!.total_count).toBe(1);
    });
  });
});
