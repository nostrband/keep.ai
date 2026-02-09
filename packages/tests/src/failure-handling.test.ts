import { describe, it, expect } from "vitest";
import {
  errorTypeToRunStatus,
  getRunStatusForError,
  isDefiniteFailure,
} from "@app/agent";
import {
  AuthError,
  PermissionError,
  NetworkError,
  LogicError,
  InternalError,
  ClassifiedError,
} from "@app/proto";

/**
 * Tests for failure handling module (exec-12).
 *
 * Why these tests matter:
 * Error classification drives the entire failure routing pipeline.
 * A misclassification can cause:
 * - Auto-fix attempts on infrastructure failures (wasting tokens)
 * - Silent retries on logic bugs (infinite loops)
 * - User escalation for transient network blips (poor UX)
 */

describe("Failure Handling (exec-12)", () => {
  describe("errorTypeToRunStatus", () => {
    it("should map auth errors to paused:approval", () => {
      expect(errorTypeToRunStatus("auth")).toBe("paused:approval");
    });

    it("should map permission errors to paused:approval", () => {
      expect(errorTypeToRunStatus("permission")).toBe("paused:approval");
    });

    it("should map network errors to paused:transient", () => {
      expect(errorTypeToRunStatus("network")).toBe("paused:transient");
    });

    it("should map logic errors to failed:logic", () => {
      expect(errorTypeToRunStatus("logic")).toBe("failed:logic");
    });

    it("should map internal errors to failed:internal", () => {
      expect(errorTypeToRunStatus("internal")).toBe("failed:internal");
    });
  });

  describe("getRunStatusForError", () => {
    it("should classify AuthError and return paused:approval", () => {
      const error = new AuthError("Token expired");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("paused:approval");
      expect(result.error).toBe(error);
    });

    it("should classify PermissionError and return paused:approval", () => {
      const error = new PermissionError("Forbidden");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("paused:approval");
      expect(result.error).toBe(error);
    });

    it("should classify NetworkError and return paused:transient", () => {
      const error = new NetworkError("Connection refused");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("paused:transient");
      expect(result.error).toBe(error);
    });

    it("should classify LogicError and return failed:logic", () => {
      const error = new LogicError("Invalid input");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("failed:logic");
      expect(result.error).toBe(error);
    });

    it("should classify InternalError and return failed:internal", () => {
      const error = new InternalError("Null pointer");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("failed:internal");
      expect(result.error).toBe(error);
    });

    it("should wrap unclassified Error as InternalError", () => {
      const error = new Error("Something broke");
      const result = getRunStatusForError(error);
      expect(result.status).toBe("failed:internal");
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain("Unclassified error");
      expect(result.error.message).toContain("Something broke");
    });

    it("should wrap unclassified string as InternalError", () => {
      const result = getRunStatusForError("oops");
      expect(result.status).toBe("failed:internal");
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain("oops");
    });

    it("should wrap non-Error objects as InternalError", () => {
      const result = getRunStatusForError(42);
      expect(result.status).toBe("failed:internal");
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain("42");
    });

    it("should wrap null as InternalError", () => {
      const result = getRunStatusForError(null);
      expect(result.status).toBe("failed:internal");
      expect(result.error).toBeInstanceOf(InternalError);
    });

    it("should include source in wrapped error message", () => {
      const error = new Error("timeout");
      const result = getRunStatusForError(error, "gmail-connector");
      expect(result.error.message).toContain("gmail-connector");
      expect(result.error.message).toContain("timeout");
    });

    it("should preserve cause for Error instances", () => {
      const original = new Error("root cause");
      const result = getRunStatusForError(original);
      expect(result.error.cause).toBe(original);
    });

    it("should not set cause for non-Error values", () => {
      const result = getRunStatusForError("string error");
      expect(result.error.cause).toBeUndefined();
    });
  });

  describe("isDefiniteFailure", () => {
    it("should return true for logic errors", () => {
      const error = new LogicError("Validation failed");
      expect(isDefiniteFailure(error)).toBe(true);
    });

    it("should return true for permission errors", () => {
      const error = new PermissionError("403 Forbidden");
      expect(isDefiniteFailure(error)).toBe(true);
    });

    it("should return false for auth errors (may be indeterminate)", () => {
      const error = new AuthError("Token expired mid-request");
      expect(isDefiniteFailure(error)).toBe(false);
    });

    it("should return false for network errors (may be indeterminate)", () => {
      const error = new NetworkError("Connection reset");
      expect(isDefiniteFailure(error)).toBe(false);
    });

    it("should return false for internal errors", () => {
      const error = new InternalError("Null reference");
      expect(isDefiniteFailure(error)).toBe(false);
    });
  });
});
