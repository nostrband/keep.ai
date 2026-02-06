import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ScriptStore, Script, Workflow } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Tests for Intent Spec integration with maintainer context (exec-17).
 *
 * These tests verify that the intent_spec is properly included in the
 * maintainer context and displayed correctly.
 */

/**
 * Helper to create the minimal tables needed for these tests.
 */
async function createTestTables(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      major_version INTEGER NOT NULL DEFAULT 0,
      minor_version INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      change_comment TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      diagram TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_workflow_id ON scripts(workflow_id)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      cron TEXT NOT NULL DEFAULT '',
      events TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      next_run_timestamp TEXT NOT NULL DEFAULT '',
      maintenance INTEGER NOT NULL DEFAULT 0,
      maintenance_fix_count INTEGER NOT NULL DEFAULT 0,
      active_script_id TEXT NOT NULL DEFAULT '',
      handler_config TEXT NOT NULL DEFAULT '',
      intent_spec TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_task_id ON workflows(task_id)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY NOT NULL,
      script_id TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      retry_of TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

describe("Maintainer Intent Integration", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let scriptStore: ScriptStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTestTables(db);
    scriptStore = new ScriptStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  const createWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
    id: "workflow-1",
    title: "Test Workflow",
    task_id: "task-1",
    chat_id: "chat-1",
    timestamp: new Date().toISOString(),
    cron: "0 9 * * *",
    events: "",
    status: "active",
    next_run_timestamp: "",
    maintenance: true,
    maintenance_fix_count: 0,
    active_script_id: "script-1",
    handler_config: "",
    intent_spec: "",
    ...overrides,
  });

  const createScript = (overrides: Partial<Script> = {}): Script => ({
    id: "script-1",
    task_id: "task-1",
    major_version: 1,
    minor_version: 0,
    timestamp: new Date().toISOString(),
    code: "const workflow = { producers: {}, consumers: {} };",
    change_comment: "",
    workflow_id: "workflow-1",
    type: "",
    summary: "",
    diagram: "",
    ...overrides,
  });

  describe("Database intent_spec field", () => {
    it("should store and retrieve intent_spec as JSON string", async () => {
      const intentSpec = JSON.stringify({
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-1",
        goal: "Send daily summaries",
        inputs: ["Email inbox"],
        outputs: ["Slack message"],
        assumptions: ["9am local time"],
        nonGoals: [],
        semanticConstraints: [],
        title: "Daily Summary",
      });

      const workflow = createWorkflow({ intent_spec: intentSpec });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflow("workflow-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.intent_spec).toBe(intentSpec);

      // Verify it can be parsed
      const parsed = JSON.parse(retrieved!.intent_spec);
      expect(parsed.goal).toBe("Send daily summaries");
      expect(parsed.title).toBe("Daily Summary");
    });

    it("should handle empty intent_spec", async () => {
      const workflow = createWorkflow({ intent_spec: "" });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflow("workflow-1");
      expect(retrieved!.intent_spec).toBe("");
    });

    it("should update intent_spec via updateWorkflowFields", async () => {
      const workflow = createWorkflow({ intent_spec: "" });
      await scriptStore.addWorkflow(workflow);

      const newIntentSpec = JSON.stringify({
        version: 1,
        extractedAt: "2024-01-02T00:00:00.000Z",
        extractedFromTaskId: "task-1",
        goal: "Updated goal",
        inputs: [],
        outputs: [],
        assumptions: [],
        nonGoals: [],
        semanticConstraints: [],
        title: "Updated",
      });

      await scriptStore.updateWorkflowFields("workflow-1", { intent_spec: newIntentSpec });

      const retrieved = await scriptStore.getWorkflow("workflow-1");
      expect(retrieved!.intent_spec).toBe(newIntentSpec);
    });
  });

  describe("Workflow queries include intent_spec", () => {
    it("should include intent_spec in getWorkflowByTaskId", async () => {
      const intentSpec = JSON.stringify({ version: 1, goal: "Task query test" });
      const workflow = createWorkflow({ intent_spec: intentSpec });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflowByTaskId("task-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.intent_spec).toBe(intentSpec);
    });

    it("should include intent_spec in getWorkflow after addWorkflow", async () => {
      const intentSpec = JSON.stringify({ version: 1, goal: "Add and get test" });
      const workflow = createWorkflow({ id: "workflow-add-get", intent_spec: intentSpec });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflow("workflow-add-get");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.intent_spec).toBe(intentSpec);
    });

    it("should include intent_spec in getWorkflowByChatId", async () => {
      const intentSpec = JSON.stringify({ version: 1, goal: "Chat query test" });
      const workflow = createWorkflow({ chat_id: "chat-test", intent_spec: intentSpec });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflowByChatId("chat-test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.intent_spec).toBe(intentSpec);
    });
  });

  describe("IntentSpec type structure", () => {
    it("should store complex IntentSpec with all fields", async () => {
      const intentSpec = {
        version: 1,
        extractedAt: "2024-01-01T12:00:00.000Z",
        extractedFromTaskId: "task-abc123",
        goal: "Extract invoice data from emails and add to accounting spreadsheet",
        inputs: [
          "Emails with attachments from invoices@company.com",
          "PDF invoice attachments",
        ],
        outputs: [
          "New rows in Google Sheet with vendor, amount, date",
          "Slack notification for invoices over $1000",
        ],
        assumptions: [
          "Process emails every 5 minutes",
          "Invoice amounts are in USD",
          "Vendor name is in email subject",
        ],
        nonGoals: [
          "Duplicate invoice detection",
          "Invoice approval workflow",
        ],
        semanticConstraints: [
          "Never process the same email twice",
          "Preserve original PDF in Drive",
        ],
        title: "Invoice to Spreadsheet",
      };

      const workflow = createWorkflow({ intent_spec: JSON.stringify(intentSpec) });
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflow("workflow-1");
      const parsed = JSON.parse(retrieved!.intent_spec);

      expect(parsed.version).toBe(1);
      expect(parsed.extractedAt).toBe("2024-01-01T12:00:00.000Z");
      expect(parsed.extractedFromTaskId).toBe("task-abc123");
      expect(parsed.goal).toContain("invoice data");
      expect(parsed.inputs).toHaveLength(2);
      expect(parsed.outputs).toHaveLength(2);
      expect(parsed.assumptions).toHaveLength(3);
      expect(parsed.nonGoals).toHaveLength(2);
      expect(parsed.semanticConstraints).toHaveLength(2);
      expect(parsed.title).toBe("Invoice to Spreadsheet");
    });
  });

  describe("MaintainerContext integration", () => {
    it("should preserve intent_spec when workflow is retrieved for maintainer", async () => {
      const intentSpec = JSON.stringify({
        version: 1,
        goal: "Process orders",
        inputs: ["Order events"],
        outputs: ["Inventory updates"],
        assumptions: ["Real-time processing"],
        nonGoals: [],
        semanticConstraints: ["Idempotent processing"],
        title: "Order Processor",
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-1",
      });

      const workflow = createWorkflow({
        maintenance: true,
        intent_spec: intentSpec,
      });
      const script = createScript();

      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      // Simulate what loadMaintainerContext does - get the workflow
      const retrieved = await scriptStore.getWorkflow("workflow-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.intent_spec).toBe(intentSpec);
      expect(retrieved!.maintenance).toBe(true);
    });
  });
});
