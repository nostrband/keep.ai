import { describe, it, expect } from "vitest";
import {
  parseInterval,
  computeNextRunTime,
  extractSchedule,
} from "@app/agent";

/**
 * Tests for schedule utilities (exec-13).
 *
 * Why these tests matter:
 * Schedule parsing drives producer scheduling. A parsing bug could cause
 * producers to poll at wrong intervals (too frequent = API abuse / cost,
 * too infrequent = missed events).
 */

describe("Schedule Utils (exec-13)", () => {
  describe("parseInterval", () => {
    it("should parse seconds", () => {
      expect(parseInterval("30s")).toBe(30_000);
    });

    it("should parse minutes", () => {
      expect(parseInterval("5m")).toBe(5 * 60_000);
    });

    it("should parse hours", () => {
      expect(parseInterval("1h")).toBe(60 * 60_000);
    });

    it("should parse days", () => {
      expect(parseInterval("1d")).toBe(24 * 60 * 60_000);
    });

    it("should parse large values", () => {
      expect(parseInterval("999s")).toBe(999_000);
      expect(parseInterval("120m")).toBe(120 * 60_000);
    });

    it("should throw on invalid format", () => {
      expect(() => parseInterval("5")).toThrow("Invalid interval format");
      expect(() => parseInterval("abc")).toThrow("Invalid interval format");
      expect(() => parseInterval("")).toThrow("Invalid interval format");
      expect(() => parseInterval("5x")).toThrow("Invalid interval format");
      expect(() => parseInterval("m5")).toThrow("Invalid interval format");
    });

    it("should throw on negative values", () => {
      expect(() => parseInterval("-5m")).toThrow("Invalid interval format");
    });

    it("should throw on decimal values", () => {
      expect(() => parseInterval("1.5m")).toThrow("Invalid interval format");
    });
  });

  describe("computeNextRunTime", () => {
    it("should compute next run time for interval schedule", () => {
      const baseTime = 1000000;
      const result = computeNextRunTime("interval", "5m", baseTime);
      expect(result).toBe(baseTime + 5 * 60_000);
    });

    it("should compute next run time for interval with different units", () => {
      const baseTime = 1000000;
      expect(computeNextRunTime("interval", "30s", baseTime)).toBe(baseTime + 30_000);
      expect(computeNextRunTime("interval", "1h", baseTime)).toBe(baseTime + 3_600_000);
      expect(computeNextRunTime("interval", "1d", baseTime)).toBe(baseTime + 86_400_000);
    });

    it("should compute next run time for cron schedule", () => {
      const result = computeNextRunTime("cron", "* * * * *");
      // Should be in the future (within next ~60 seconds)
      expect(result).toBeGreaterThan(Date.now());
      expect(result).toBeLessThanOrEqual(Date.now() + 61_000);
    });

    it("should fallback to 1 minute for invalid cron", () => {
      const baseTime = 1000000;
      const result = computeNextRunTime("cron", "not a cron", baseTime);
      expect(result).toBe(baseTime + 60_000);
    });

    it("should use Date.now() when no baseTime provided", () => {
      const before = Date.now();
      const result = computeNextRunTime("interval", "5m");
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before + 5 * 60_000);
      expect(result).toBeLessThanOrEqual(after + 5 * 60_000);
    });

    it("should throw on invalid schedule type", () => {
      expect(() =>
        computeNextRunTime("weekly" as any, "value")
      ).toThrow("Invalid schedule type");
    });
  });

  describe("extractSchedule", () => {
    it("should extract interval schedule", () => {
      const result = extractSchedule({ interval: "5m" });
      expect(result).toEqual({ type: "interval", value: "5m" });
    });

    it("should extract cron schedule", () => {
      const result = extractSchedule({ cron: "0 * * * *" });
      expect(result).toEqual({ type: "cron", value: "0 * * * *" });
    });

    it("should prefer interval over cron when both present", () => {
      const result = extractSchedule({ interval: "5m", cron: "0 * * * *" });
      expect(result).toEqual({ type: "interval", value: "5m" });
    });

    it("should return null when no schedule configured", () => {
      expect(extractSchedule({})).toBeNull();
    });

    it("should return null for empty strings", () => {
      expect(extractSchedule({ interval: "" })).toBeNull();
      expect(extractSchedule({ cron: "" })).toBeNull();
    });
  });
});
