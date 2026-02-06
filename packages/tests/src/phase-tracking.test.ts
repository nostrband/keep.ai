import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, KeepDbApi, Mutation } from "@app/db";
import { createDBNode } from "@app/node";
import { ToolWrapper, ExecutionPhase, OperationType, EvalContext } from "@app/agent";
import { z } from "zod";
import { LogicError } from "@app/agent";
import { Tool, defineReadOnlyTool, defineTool } from "@app/agent";

/**
 * Creates a mock EvalContext for testing.
 * Provides all required fields with sensible defaults.
 */
function createMockContext(taskId: string = "task-1"): EvalContext {
  return {
    taskId,
    taskThreadId: "thread-1",
    step: 1,
    type: "workflow",
    cost: 0,
    createEvent: async () => {},
    onLog: async () => {},
  };
}

/**
 * Helper to create required tables for ToolWrapper testing.
 */
async function createTables(db: DBInterface): Promise<void> {
  // Minimal schema for workflow status checking
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      active_script_id TEXT NOT NULL DEFAULT '',
      handler_config TEXT NOT NULL DEFAULT ''
    )
  `);
}

// Helper function to create a mock read-only tool
function createReadOnlyTool(name: string): Tool<{ value: string }, string> {
  return defineReadOnlyTool({
    namespace: "Test",
    name,
    description: `Test read-only tool: ${name}`,
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.string(),
    execute: async (input) => `Read: ${input.value}`,
  }) as Tool<{ value: string }, string>;
}

// Helper function to create a mock mutating tool
function createMutatingTool(name: string): Tool<{ value: string }, string> {
  return defineTool({
    namespace: "Test",
    name,
    description: `Test mutating tool: ${name}`,
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.string(),
    isReadOnly: () => false,
    execute: async (input) => `Mutated: ${input.value}`,
  }) as Tool<{ value: string }, string>;
}

// Helper to create mock Topics tools
function createMockTopicsPeekTool(): Tool<{ topic: string }, { messageId: string }[]> {
  return defineReadOnlyTool({
    namespace: "Topics",
    name: "peek",
    description: "Peek at topics",
    inputSchema: z.object({ topic: z.string() }),
    outputSchema: z.array(z.object({ messageId: z.string() })),
    execute: async () => [{ messageId: "msg-1" }],
  }) as Tool<{ topic: string }, { messageId: string }[]>;
}

function createMockTopicsGetByIdsTool(): Tool<{ topic: string; ids: string[] }, { messageId: string }[]> {
  return defineReadOnlyTool({
    namespace: "Topics",
    name: "getByIds",
    description: "Get topics by IDs",
    inputSchema: z.object({ topic: z.string(), ids: z.array(z.string()) }),
    outputSchema: z.array(z.object({ messageId: z.string() })),
    execute: async () => [{ messageId: "msg-1" }],
  }) as Tool<{ topic: string; ids: string[] }, { messageId: string }[]>;
}

function createMockTopicsPublishTool(): Tool<{ topic: string; event: { messageId: string } }, void> {
  return defineTool({
    namespace: "Topics",
    name: "publish",
    description: "Publish to topics",
    inputSchema: z.object({ topic: z.string(), event: z.object({ messageId: z.string() }) }),
    outputSchema: z.void(),
    isReadOnly: () => false,
    execute: async () => {},
  }) as Tool<{ topic: string; event: { messageId: string } }, void>;
}

describe("ToolWrapper Phase Tracking", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let api: KeepDbApi;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    api = new KeepDbApi(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Phase state management", () => {
    it("should start with null phase (task mode)", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      expect(wrapper.getPhase()).toBeNull();
    });

    it("should update phase via setPhase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('producer');
      expect(wrapper.getPhase()).toBe('producer');

      wrapper.setPhase('prepare');
      expect(wrapper.getPhase()).toBe('prepare');

      wrapper.setPhase('mutate');
      expect(wrapper.getPhase()).toBe('mutate');

      wrapper.setPhase('next');
      expect(wrapper.getPhase()).toBe('next');

      wrapper.setPhase(null);
      expect(wrapper.getPhase()).toBeNull();
    });

    it("should reset mutationExecuted when phase changes", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      // Set to mutate phase and execute a mutation
      wrapper.setPhase('mutate');
      wrapper.checkPhaseAllowed('mutate'); // First mutation - allowed

      // Trying second mutation in same phase should fail
      expect(() => wrapper.checkPhaseAllowed('mutate'))
        .toThrow('Only one mutation allowed per mutate phase');

      // Change phase
      wrapper.setPhase('mutate');

      // Now mutation should be allowed again
      expect(() => wrapper.checkPhaseAllowed('mutate')).not.toThrow();
    });

    it("should reset currentMutation when phase changes", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      const mockMutation: Mutation = {
        id: "mut-1",
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
        tool_namespace: "Test",
        tool_method: "mutate",
        params: "{}",
        idempotency_key: "",
        status: "pending",
        result: "",
        error: "",
        reconcile_attempts: 0,
        last_reconcile_at: 0,
        next_reconcile_at: 0,
        resolved_by: "",
        resolved_at: 0,
        ui_title: "",
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      wrapper.setCurrentMutation(mockMutation);
      expect(wrapper.getCurrentMutation()).toEqual(mockMutation);

      wrapper.setPhase('prepare');
      expect(wrapper.getCurrentMutation()).toBeNull();
    });
  });

  describe("Mutation tracking", () => {
    it("should set and get current mutation", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      const mockMutation: Mutation = {
        id: "mut-1",
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: '{"to":"alice@example.com"}',
        idempotency_key: "",
        status: "in_flight",
        result: "",
        error: "",
        reconcile_attempts: 0,
        last_reconcile_at: 0,
        next_reconcile_at: 0,
        resolved_by: "",
        resolved_at: 0,
        ui_title: "",
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      wrapper.setCurrentMutation(mockMutation);
      expect(wrapper.getCurrentMutation()).toEqual(mockMutation);
    });

    it("should clear mutation when set to null", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      const mockMutation: Mutation = {
        id: "mut-1",
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
        tool_namespace: "Test",
        tool_method: "mutate",
        params: "{}",
        idempotency_key: "",
        status: "pending",
        result: "",
        error: "",
        reconcile_attempts: 0,
        last_reconcile_at: 0,
        next_reconcile_at: 0,
        resolved_by: "",
        resolved_at: 0,
        ui_title: "",
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      wrapper.setCurrentMutation(mockMutation);
      wrapper.setCurrentMutation(null);
      expect(wrapper.getCurrentMutation()).toBeNull();
    });
  });

  describe("checkPhaseAllowed - Producer phase", () => {
    it("should allow read operations in producer phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('producer');
      expect(() => wrapper.checkPhaseAllowed('read')).not.toThrow();
    });

    it("should allow topic_publish in producer phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('producer');
      expect(() => wrapper.checkPhaseAllowed('topic_publish')).not.toThrow();
    });

    it("should disallow mutate in producer phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('producer');
      expect(() => wrapper.checkPhaseAllowed('mutate'))
        .toThrow("Operation 'mutate' not allowed in 'producer' phase");
    });

    it("should disallow topic_peek in producer phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('producer');
      expect(() => wrapper.checkPhaseAllowed('topic_peek'))
        .toThrow("Operation 'topic_peek' not allowed in 'producer' phase");
    });
  });

  describe("checkPhaseAllowed - Prepare phase", () => {
    it("should allow read operations in prepare phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('prepare');
      expect(() => wrapper.checkPhaseAllowed('read')).not.toThrow();
    });

    it("should allow topic_peek in prepare phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('prepare');
      expect(() => wrapper.checkPhaseAllowed('topic_peek')).not.toThrow();
    });

    it("should disallow mutate in prepare phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('prepare');
      expect(() => wrapper.checkPhaseAllowed('mutate'))
        .toThrow("Operation 'mutate' not allowed in 'prepare' phase");
    });

    it("should disallow topic_publish in prepare phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('prepare');
      expect(() => wrapper.checkPhaseAllowed('topic_publish'))
        .toThrow("Operation 'topic_publish' not allowed in 'prepare' phase");
    });
  });

  describe("checkPhaseAllowed - Mutate phase", () => {
    it("should allow mutate in mutate phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      expect(() => wrapper.checkPhaseAllowed('mutate')).not.toThrow();
    });

    it("should disallow read in mutate phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      expect(() => wrapper.checkPhaseAllowed('read'))
        .toThrow("Operation 'read' not allowed in 'mutate' phase");
    });

    it("should disallow topic_peek in mutate phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      expect(() => wrapper.checkPhaseAllowed('topic_peek'))
        .toThrow("Operation 'topic_peek' not allowed in 'mutate' phase");
    });

    it("should disallow topic_publish in mutate phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      expect(() => wrapper.checkPhaseAllowed('topic_publish'))
        .toThrow("Operation 'topic_publish' not allowed in 'mutate' phase");
    });

    it("should enforce single mutation per mutate phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      wrapper.checkPhaseAllowed('mutate'); // First mutation - allowed

      expect(() => wrapper.checkPhaseAllowed('mutate'))
        .toThrow('Only one mutation allowed per mutate phase');
    });
  });

  describe("checkPhaseAllowed - Next phase", () => {
    it("should allow topic_publish in next phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('next');
      expect(() => wrapper.checkPhaseAllowed('topic_publish')).not.toThrow();
    });

    it("should disallow read in next phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('next');
      expect(() => wrapper.checkPhaseAllowed('read'))
        .toThrow("Operation 'read' not allowed in 'next' phase");
    });

    it("should disallow mutate in next phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('next');
      expect(() => wrapper.checkPhaseAllowed('mutate'))
        .toThrow("Operation 'mutate' not allowed in 'next' phase");
    });

    it("should disallow topic_peek in next phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('next');
      expect(() => wrapper.checkPhaseAllowed('topic_peek'))
        .toThrow("Operation 'topic_peek' not allowed in 'next' phase");
    });
  });

  describe("checkPhaseAllowed - Null phase (task mode)", () => {
    it("should allow all operations in null phase (task mode)", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      // Phase is null by default (task mode)
      expect(wrapper.getPhase()).toBeNull();

      expect(() => wrapper.checkPhaseAllowed('read')).not.toThrow();
      expect(() => wrapper.checkPhaseAllowed('mutate')).not.toThrow();
      expect(() => wrapper.checkPhaseAllowed('topic_peek')).not.toThrow();
      expect(() => wrapper.checkPhaseAllowed('topic_publish')).not.toThrow();
    });

    it("should allow multiple mutations in null phase", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      // Multiple mutations in task mode should not be restricted
      expect(() => {
        wrapper.checkPhaseAllowed('mutate');
        wrapper.checkPhaseAllowed('mutate');
        wrapper.checkPhaseAllowed('mutate');
      }).not.toThrow();
    });
  });

  describe("Tool execution with phase enforcement", () => {
    it("should enforce phase restrictions when calling tools", async () => {
      const readTool = createReadOnlyTool("readData");
      const mutateTool = createMutatingTool("writeData");

      const wrapper = new ToolWrapper({
        tools: [readTool, mutateTool],
        api,
        getContext: () => createMockContext(),
      });

      const global = await wrapper.createGlobal();
      const testNs = global.Test as Record<string, (input: unknown) => Promise<unknown>>;

      // In prepare phase, read should work
      wrapper.setPhase('prepare');
      const readResult = await testNs.readData({ value: "test" });
      expect(readResult).toBe("Read: test");

      // In prepare phase, mutate should fail
      await expect(testNs.writeData({ value: "test" }))
        .rejects.toThrow("Operation 'mutate' not allowed in 'prepare' phase");
    });

    it("should detect Topics.peek as topic_peek operation", async () => {
      const peekTool = createMockTopicsPeekTool();

      const wrapper = new ToolWrapper({
        tools: [peekTool],
        api,
        getContext: () => createMockContext(),
      });

      const global = await wrapper.createGlobal();
      const topics = global.Topics as Record<string, (input: unknown) => Promise<unknown>>;

      // In producer phase, peek should fail
      wrapper.setPhase('producer');
      await expect(topics.peek({ topic: "test" }))
        .rejects.toThrow("Operation 'topic_peek' not allowed in 'producer' phase");

      // In prepare phase, peek should work
      wrapper.setPhase('prepare');
      const result = await topics.peek({ topic: "test" });
      expect(result).toEqual([{ messageId: "msg-1" }]);
    });

    it("should detect Topics.getByIds as topic_peek operation", async () => {
      const getByIdsTool = createMockTopicsGetByIdsTool();

      const wrapper = new ToolWrapper({
        tools: [getByIdsTool],
        api,
        getContext: () => createMockContext(),
      });

      const global = await wrapper.createGlobal();
      const topics = global.Topics as Record<string, (input: unknown) => Promise<unknown>>;

      // In mutate phase, getByIds should fail
      wrapper.setPhase('mutate');
      await expect(topics.getByIds({ topic: "test", ids: ["msg-1"] }))
        .rejects.toThrow("Operation 'topic_peek' not allowed in 'mutate' phase");

      // In prepare phase, getByIds should work
      wrapper.setPhase('prepare');
      const result = await topics.getByIds({ topic: "test", ids: ["msg-1"] });
      expect(result).toEqual([{ messageId: "msg-1" }]);
    });

    it("should detect Topics.publish as topic_publish operation", async () => {
      const publishTool = createMockTopicsPublishTool();

      const wrapper = new ToolWrapper({
        tools: [publishTool],
        api,
        getContext: () => createMockContext(),
      });

      const global = await wrapper.createGlobal();
      const topics = global.Topics as Record<string, (input: unknown) => Promise<unknown>>;

      // In prepare phase, publish should fail
      wrapper.setPhase('prepare');
      await expect(topics.publish({ topic: "test", event: { messageId: "msg-1" } }))
        .rejects.toThrow("Operation 'topic_publish' not allowed in 'prepare' phase");

      // In producer phase, publish should work
      wrapper.setPhase('producer');
      await expect(topics.publish({ topic: "test", event: { messageId: "msg-1" } }))
        .resolves.not.toThrow();

      // In next phase, publish should work
      wrapper.setPhase('next');
      await expect(topics.publish({ topic: "test", event: { messageId: "msg-2" } }))
        .resolves.not.toThrow();
    });

    it("should allow all operations in null phase (task mode)", async () => {
      const readTool = createReadOnlyTool("readData");
      const mutateTool = createMutatingTool("writeData");
      const peekTool = createMockTopicsPeekTool();
      const publishTool = createMockTopicsPublishTool();

      const wrapper = new ToolWrapper({
        tools: [readTool, mutateTool, peekTool, publishTool],
        api,
        getContext: () => createMockContext(),
      });

      const global = await wrapper.createGlobal();
      const testNs = global.Test as Record<string, (input: unknown) => Promise<unknown>>;
      const topics = global.Topics as Record<string, (input: unknown) => Promise<unknown>>;

      // Phase is null (task mode) - all operations should work
      expect(wrapper.getPhase()).toBeNull();

      await expect(testNs.readData({ value: "test" })).resolves.toBe("Read: test");
      await expect(testNs.writeData({ value: "test" })).resolves.toBe("Mutated: test");
      await expect(topics.peek({ topic: "test" })).resolves.toEqual([{ messageId: "msg-1" }]);
      await expect(topics.publish({ topic: "test", event: { messageId: "msg-1" } })).resolves.not.toThrow();
    });
  });

  describe("Phase matrix complete coverage", () => {
    const phases: Exclude<ExecutionPhase, null>[] = ['producer', 'prepare', 'mutate', 'next'];
    const operations: OperationType[] = ['read', 'mutate', 'topic_peek', 'topic_publish', 'register_input'];

    // Expected allowances based on PHASE_RESTRICTIONS
    const expectations: Record<Exclude<ExecutionPhase, null>, Record<OperationType, boolean>> = {
      producer: { read: true, mutate: false, topic_peek: false, topic_publish: true, register_input: true },
      prepare:  { read: true, mutate: false, topic_peek: true, topic_publish: false, register_input: false },
      mutate:   { read: false, mutate: true, topic_peek: false, topic_publish: false, register_input: false },
      next:     { read: false, mutate: false, topic_peek: false, topic_publish: true, register_input: false },
    };

    for (const phase of phases) {
      for (const operation of operations) {
        const shouldAllow = expectations[phase][operation];

        it(`should ${shouldAllow ? 'allow' : 'disallow'} '${operation}' in '${phase}' phase`, () => {
          const wrapper = new ToolWrapper({
            tools: [],
            api,
            getContext: () => createMockContext(),
          });

          wrapper.setPhase(phase);

          if (shouldAllow) {
            expect(() => wrapper.checkPhaseAllowed(operation)).not.toThrow();
          } else {
            expect(() => wrapper.checkPhaseAllowed(operation))
              .toThrow(`Operation '${operation}' not allowed in '${phase}' phase`);
          }
        });
      }
    }
  });

  describe("Error type verification", () => {
    it("should throw LogicError for phase violations", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('prepare');

      try {
        wrapper.checkPhaseAllowed('mutate');
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LogicError);
        expect((error as LogicError).message).toContain("Operation 'mutate' not allowed in 'prepare' phase");
      }
    });

    it("should throw LogicError for multiple mutations", () => {
      const wrapper = new ToolWrapper({
        tools: [],
        api,
        getContext: () => createMockContext(),
      });

      wrapper.setPhase('mutate');
      wrapper.checkPhaseAllowed('mutate');

      try {
        wrapper.checkPhaseAllowed('mutate');
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LogicError);
        expect((error as LogicError).message).toBe('Only one mutation allowed per mutate phase');
      }
    });
  });
});
