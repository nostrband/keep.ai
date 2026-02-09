import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeWebFetchTool,
  makeWebSearchTool,
  setEnv,
  type EvalContext,
} from "@app/agent";

// Mock the Exa SDK
vi.mock("exa-js", () => {
  return {
    Exa: vi.fn().mockImplementation(() => ({
      getContents: vi.fn(),
      search: vi.fn(),
    })),
  };
});

function createMockContext(): EvalContext {
  return {
    taskThreadId: "test-thread",
    step: 0,
    type: "workflow",
    taskId: "test-task",
    cost: 0,
    createEvent: vi.fn().mockResolvedValue(undefined),
    onLog: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Web Tools", () => {
  let mockContext: EvalContext;

  beforeEach(() => {
    mockContext = createMockContext();
    setEnv({ EXA_API_KEY: "test-exa-key" });
  });

  describe("Web.fetchParse", () => {
    it("should throw AuthError when EXA_API_KEY is missing", async () => {
      setEnv({ EXA_API_KEY: undefined });

      const tool = makeWebFetchTool(() => mockContext);

      await expect(
        tool.execute({ url: "https://example.com" } as any)
      ).rejects.toThrow("EXA_API_KEY environment variable is not set");
    });

    it("should throw LogicError when url is invalid", async () => {
      const tool = makeWebFetchTool(() => mockContext);

      await expect(
        tool.execute({ url: "" } as any)
      ).rejects.toThrow();
    });

    it("should accept string shorthand input", async () => {
      // This tests the zod union parsing — the tool won't reach the API
      // because our Exa mock returns undefined by default
      setEnv({ EXA_API_KEY: undefined });
      const tool = makeWebFetchTool(() => mockContext);

      // With no API key, it should throw AuthError regardless of input format
      await expect(
        tool.execute("https://example.com" as any)
      ).rejects.toThrow("EXA_API_KEY");
    });

    it("should be a read-only tool", () => {
      const tool = makeWebFetchTool(() => mockContext);
      expect(tool.isReadOnly?.({} as any)).toBe(true);
    });

    it("should have correct namespace and name", () => {
      const tool = makeWebFetchTool(() => mockContext);
      expect(tool.namespace).toBe("Web");
      expect(tool.name).toBe("fetchParse");
    });
  });

  describe("Web.search", () => {
    it("should throw AuthError when EXA_API_KEY is missing", async () => {
      setEnv({ EXA_API_KEY: undefined });

      const tool = makeWebSearchTool(() => mockContext);

      await expect(
        tool.execute({ query: "test query" } as any)
      ).rejects.toThrow("EXA_API_KEY environment variable is not set");
    });

    it("should throw LogicError when query is empty", async () => {
      const tool = makeWebSearchTool(() => mockContext);

      await expect(
        tool.execute({ query: "" } as any)
      ).rejects.toThrow();
    });

    it("should accept string shorthand input", async () => {
      setEnv({ EXA_API_KEY: undefined });
      const tool = makeWebSearchTool(() => mockContext);

      await expect(
        tool.execute("test search" as any)
      ).rejects.toThrow("EXA_API_KEY");
    });

    it("should be a read-only tool", () => {
      const tool = makeWebSearchTool(() => mockContext);
      expect(tool.isReadOnly?.({} as any)).toBe(true);
    });

    it("should have correct namespace and name", () => {
      const tool = makeWebSearchTool(() => mockContext);
      expect(tool.namespace).toBe("Web");
      expect(tool.name).toBe("search");
    });
  });
});
