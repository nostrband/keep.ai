import { describe, it, expect } from "vitest";
import { formatCronSchedule } from "@app/agent";

describe("formatCronSchedule", () => {
  it("should handle step expressions for minutes", () => {
    expect(formatCronSchedule("*/5 * * * *")).toBe("Every 5 minutes");
    expect(formatCronSchedule("*/30 * * * *")).toBe("Every 30 minutes");
    expect(formatCronSchedule("*/1 * * * *")).toBe("Every 1 minutes");
  });

  it("should handle step expressions for hours", () => {
    expect(formatCronSchedule("0 */2 * * *")).toBe("Every 2 hours");
    expect(formatCronSchedule("0 */6 * * *")).toBe("Every 6 hours");
  });

  it("should handle every minute", () => {
    expect(formatCronSchedule("* * * * *")).toBe("Every minute");
  });

  it("should handle every hour at specific minute", () => {
    expect(formatCronSchedule("0 * * * *")).toBe("Every hour at :00");
    expect(formatCronSchedule("30 * * * *")).toBe("Every hour at :30");
  });

  it("should handle daily at specific time", () => {
    expect(formatCronSchedule("0 9 * * *")).toBe("Every day at 9:00 AM");
    expect(formatCronSchedule("30 14 * * *")).toBe("Every day at 2:30 PM");
    expect(formatCronSchedule("0 0 * * *")).toBe("Every day at 12:00 AM");
  });

  it("should handle weekly on specific day", () => {
    expect(formatCronSchedule("0 9 * * 1")).toBe("Every Monday at 9:00 AM");
    expect(formatCronSchedule("0 9 * * 0")).toBe("Every Sunday at 9:00 AM");
  });

  it("should return 'Not scheduled' for falsy input", () => {
    expect(formatCronSchedule(undefined)).toBe("Not scheduled");
    expect(formatCronSchedule("")).toBe("Not scheduled");
  });

  it("should return raw cron for unknown complex patterns", () => {
    expect(formatCronSchedule("0 9 1 * *")).toBe("0 9 1 * *");
    expect(formatCronSchedule("0 9 1,15 * *")).toBe("0 9 1,15 * *");
  });
});
