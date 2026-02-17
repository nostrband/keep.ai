import { describe, it, expect, beforeEach, vi } from "vitest";
import { atobCompatAny, createBuiltins, type EvalContext } from "@app/agent";

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

describe("Utility Builtins", () => {
  describe("atob (atobCompatAny)", () => {
    it("should decode standard base64 string", () => {
      expect(atobCompatAny("SGVsbG8gV29ybGQ=")).toBe("Hello World");
    });

    it("should decode base64url string", () => {
      // base64url uses - instead of + and _ instead of /
      const result = atobCompatAny("SGVsbG8tV29ybGQ_");
      expect(typeof result).toBe("string");
    });

    it("should handle missing padding", () => {
      // "Hi" in base64 is "SGk=" but without padding would be "SGk"
      expect(atobCompatAny("SGk")).toBe("Hi");
    });

    it("should handle empty string", () => {
      expect(atobCompatAny("")).toBe("");
    });

    it("should handle whitespace in input", () => {
      expect(atobCompatAny("SGVs bG8g V29y bGQ=")).toBe("Hello World");
    });

    it("should throw error for invalid base64", () => {
      expect(() => atobCompatAny("!!!invalid!!!")).toThrow();
    });

    it("should decode binary data", () => {
      // Base64 for bytes [0, 255, 128]
      const result = atobCompatAny("AP+A");
      expect(result.charCodeAt(0)).toBe(0);
      expect(result.charCodeAt(1)).toBe(255);
      expect(result.charCodeAt(2)).toBe(128);
    });

    it("should decode complex base64url", () => {
      // Standard base64 with + and / replaced with - and _
      expect(atobCompatAny("YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo")).toBe(
        "abcdefghijklmnopqrstuvwxyz"
      );
    });
  });

  describe("console builtins", () => {
    let mockContext: EvalContext;
    let builtins: ReturnType<typeof createBuiltins>;

    beforeEach(() => {
      mockContext = createMockContext();
      builtins = createBuiltins(() => mockContext);
    });

    it("should log a message with log level", () => {
      builtins.console.log("Test message");

      expect(mockContext.onLog).toHaveBeenCalled();
      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("LOG:");
      expect(loggedLine).toContain("'Test message'");
    });

    it("should log a message with warn level", () => {
      builtins.console.warn("Warning message");

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("WARN:");
      expect(loggedLine).toContain("'Warning message'");
    });

    it("should log a message with error level", () => {
      builtins.console.error("Error message");

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("ERROR:");
      expect(loggedLine).toContain("'Error message'");
    });

    it("should include timestamp in log", () => {
      builtins.console.log("Test");

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      // ISO timestamp format like [2024-01-15T10:30:00.000Z]
      expect(loggedLine).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should truncate long messages", () => {
      const longMessage = "x".repeat(2000);
      builtins.console.log(longMessage);

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      // Should be truncated to ~1000 chars + "..." + formatting
      expect(loggedLine.length).toBeLessThan(2000);
      expect(loggedLine).toContain("...");
    });

    it("should handle empty message", () => {
      builtins.console.log("");

      expect(mockContext.onLog).toHaveBeenCalled();
    });

    it("should join multiple arguments with spaces", () => {
      builtins.console.log("hello", 42, "world");

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain("'hello 42 world'");
    });

    it("should JSON.stringify non-string arguments", () => {
      builtins.console.log("data:", { key: "val" });

      const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
      expect(loggedLine).toContain('data: {"key":"val"}');
    });

    // Special character tests per spec: test-console-log-special-chars.md

    describe("Special character handling", () => {
      it("should handle message containing single quotes", () => {
        builtins.console.log("It's a test with 'nested quotes'");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("It\\'s a test with \\'nested quotes\\'");
      });

      it("should handle message containing newlines", () => {
        builtins.console.log("Line 1\nLine 2\nLine 3");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Line 1\nLine 2\nLine 3");
      });

      it("should handle message containing tabs", () => {
        builtins.console.log("Column1\tColumn2\tColumn3");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Column1\tColumn2\tColumn3");
      });

      it("should handle message containing carriage returns", () => {
        builtins.console.log("Line 1\r\nLine 2");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Line 1\r\nLine 2");
      });

      it("should handle message containing unicode characters", () => {
        builtins.console.log("Hello 世界 🌍 مرحبا");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Hello 世界 🌍 مرحبا");
      });

      it("should handle message containing emojis", () => {
        builtins.console.log("Status: ✅ Success 🎉");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Status: ✅ Success 🎉");
      });

      it("should handle message containing backslashes", () => {
        builtins.console.log("Path: C:\\Users\\test\\file.txt");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("C:\\\\Users\\\\test\\\\file.txt");
      });

      it("should handle message containing double quotes", () => {
        builtins.console.log('He said "hello" to me');

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain('He said "hello" to me');
      });

      it("should handle message containing null character", () => {
        builtins.console.log("Before\0After");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("Before\0After");
      });

      it("should handle message with only special characters", () => {
        builtins.console.log("!@#$%^&*()_+-=[]{}|;':\",./<>?`~");

        const loggedLine = (mockContext.onLog as any).mock.calls[0][0];
        expect(loggedLine).toContain("!@#$%^&*()_+-=[]{}|;\\':\",./");
        expect(loggedLine).toContain("<>?`~");
      });
    });
  });

  describe("atob builtin", () => {
    it("should coerce input to string", () => {
      const mockContext = createMockContext();
      const builtins = createBuiltins(() => mockContext);
      // atob builtin calls String(input) before decoding
      expect(builtins.atob("SGVsbG8gV29ybGQ=")).toBe("Hello World");
    });

    it("should throw catchable error for invalid input", () => {
      const mockContext = createMockContext();
      const builtins = createBuiltins(() => mockContext);
      expect(() => builtins.atob("!!!invalid!!!")).toThrow();
    });
  });
});
