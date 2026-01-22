import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeAtobTool, makeConsoleLogTool, type EvalContext } from "@app/agent";

/**
 * Creates a mock EvalContext for testing.
 */
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

/**
 * Creates mock ToolCallOptions for testing.
 */
function createToolCallOptions() {
  return {
    toolCallId: "test-call",
    messages: [],
    abortSignal: new AbortController().signal,
  };
}

describe("Utility Tools", () => {
  describe("makeAtobTool", () => {
    it("should decode standard base64 string", async () => {
      const atobTool = makeAtobTool();

      const result = await atobTool.execute!("SGVsbG8gV29ybGQ=", createToolCallOptions());

      expect(result).toBe("Hello World");
    });

    it("should decode base64url string", async () => {
      const atobTool = makeAtobTool();

      // base64url uses - instead of + and _ instead of /
      const result = await atobTool.execute!("SGVsbG8tV29ybGQ_", createToolCallOptions());

      // The decoded result should work
      expect(typeof result).toBe("string");
    });

    it("should handle missing padding", async () => {
      const atobTool = makeAtobTool();

      // "Hi" in base64 is "SGk=" but without padding would be "SGk"
      const result = await atobTool.execute!("SGk", createToolCallOptions());

      expect(result).toBe("Hi");
    });

    it("should handle empty string", async () => {
      const atobTool = makeAtobTool();

      const result = await atobTool.execute!("", createToolCallOptions());

      expect(result).toBe("");
    });

    it("should handle whitespace in input", async () => {
      const atobTool = makeAtobTool();

      const result = await atobTool.execute!("SGVs bG8g V29y bGQ=", createToolCallOptions());

      expect(result).toBe("Hello World");
    });

    it("should throw error for invalid base64", async () => {
      const atobTool = makeAtobTool();

      await expect(atobTool.execute!("!!!invalid!!!", createToolCallOptions())).rejects.toThrow();
    });

    it("should decode binary data", async () => {
      const atobTool = makeAtobTool();

      // Base64 for bytes [0, 255, 128]
      const result = await atobTool.execute!("AP+A", createToolCallOptions());

      expect((result as string).charCodeAt(0)).toBe(0);
      expect((result as string).charCodeAt(1)).toBe(255);
      expect((result as string).charCodeAt(2)).toBe(128);
    });

    it("should decode complex base64url", async () => {
      const atobTool = makeAtobTool();

      // Standard base64 with + and / replaced with - and _
      const result = await atobTool.execute!("YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo", createToolCallOptions());

      expect(result).toBe("abcdefghijklmnopqrstuvwxyz");
    });
  });

  describe("makeConsoleLogTool", () => {
    let mockContext: EvalContext;

    beforeEach(() => {
      mockContext = createMockContext();
    });

    it("should log a message with log level", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      const result = await consoleLogTool.execute!(
        {
          type: "log",
          line: "Test message",
        },
        createToolCallOptions()
      );

      expect(result).toEqual({ success: true });
      expect(mockContext.onLog).toHaveBeenCalled();

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("LOG:");
      expect(loggedLine).toContain("'Test message'");
    });

    it("should log a message with warn level", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      await consoleLogTool.execute!(
        {
          type: "warn",
          line: "Warning message",
        },
        createToolCallOptions()
      );

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("WARN:");
      expect(loggedLine).toContain("'Warning message'");
    });

    it("should log a message with error level", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      await consoleLogTool.execute!(
        {
          type: "error",
          line: "Error message",
        },
        createToolCallOptions()
      );

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("ERROR:");
      expect(loggedLine).toContain("'Error message'");
    });

    it("should include timestamp in log", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      await consoleLogTool.execute!(
        {
          type: "log",
          line: "Test",
        },
        createToolCallOptions()
      );

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      // ISO timestamp format like [2024-01-15T10:30:00.000Z]
      expect(loggedLine).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should truncate long messages", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      const longMessage = "x".repeat(2000);

      await consoleLogTool.execute!(
        {
          type: "log",
          line: longMessage,
        },
        createToolCallOptions()
      );

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      // Should be truncated to ~1000 chars + "..." + formatting
      expect(loggedLine.length).toBeLessThan(2000);
      expect(loggedLine).toContain("...");
    });

    it("should handle empty message", async () => {
      const consoleLogTool = makeConsoleLogTool(() => mockContext);

      const result = await consoleLogTool.execute!(
        {
          type: "log",
          line: "",
        },
        createToolCallOptions()
      );

      expect(result).toEqual({ success: true });
      expect(mockContext.onLog).toHaveBeenCalled();
    });
  });
});
