import { describe, it, expect } from "vitest";
import {
  Mutation,
} from "@app/db";
import {
  getMutationResultForNext,
} from "@app/agent";

/**
 * Tests for indeterminate mutation utilities (exec-14).
 */

describe("Indeterminate Resolution (exec-14)", () => {
  // ========================================================================
  // getMutationResultForNext (pure function)
  // ========================================================================

  describe("getMutationResultForNext", () => {
    it("should return 'none' for null mutation", () => {
      expect(getMutationResultForNext(null)).toEqual({ status: "none" });
    });

    it("should return 'applied' with parsed result for applied mutation", () => {
      const mutation = {
        status: "applied",
        result: JSON.stringify({ messageId: "abc123" }),
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("applied");
      expect(result.result).toEqual({ messageId: "abc123" });
    });

    it("should return 'applied' with null result when no result stored", () => {
      const mutation = {
        status: "applied",
        result: "",
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("applied");
      expect(result.result).toBeNull();
    });

    it("should return 'skipped' for user_skip resolution", () => {
      const mutation = {
        status: "failed",
        resolved_by: "user_skip",
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("skipped");
    });

    it("should throw for failed mutation without skip", () => {
      const mutation = {
        status: "failed",
        resolved_by: "user_assert_failed",
      } as Mutation;

      expect(() => getMutationResultForNext(mutation)).toThrow(
        "Unexpected: failed mutation without skip in next phase"
      );
    });

    it("should throw for pending mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "pending" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: pending");
    });

    it("should throw for in_flight mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "in_flight" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: in_flight");
    });

    it("should throw for needs_reconcile mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "needs_reconcile" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: needs_reconcile");
    });

    it("should throw for indeterminate mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "indeterminate" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: indeterminate");
    });
  });
});
