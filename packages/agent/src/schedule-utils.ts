/**
 * Schedule utilities for producer scheduling (exec-13).
 *
 * Provides interval parsing and next run time computation.
 */

import { Cron } from "croner";

/**
 * Parse an interval string into milliseconds.
 *
 * Supported formats:
 * - "30s" = 30 seconds
 * - "5m" = 5 minutes
 * - "1h" = 1 hour
 * - "1d" = 1 day
 *
 * @param interval - Interval string (e.g., "5m", "1h")
 * @returns Interval in milliseconds
 * @throws Error if interval format is invalid
 */
export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}. Expected format like "5m", "1h", "30s", "1d".`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Compute the next run time for a schedule.
 *
 * @param scheduleType - "interval" or "cron"
 * @param scheduleValue - The schedule value (e.g., "5m" or "0 * * * *")
 * @param baseTime - Optional base time for calculation (defaults to Date.now())
 * @returns Next run time as Unix timestamp in milliseconds
 */
export function computeNextRunTime(
  scheduleType: "interval" | "cron",
  scheduleValue: string,
  baseTime?: number
): number {
  const now = baseTime ?? Date.now();

  if (scheduleType === "cron") {
    try {
      const cron = new Cron(scheduleValue);
      const next = cron.nextRun();
      // If cron returns a valid next run, use it; otherwise fallback to 1 minute
      return next?.getTime() ?? now + 60000;
    } catch {
      // Invalid cron expression, fallback to 1 minute
      return now + 60000;
    }
  }

  if (scheduleType === "interval") {
    const intervalMs = parseInterval(scheduleValue);
    return now + intervalMs;
  }

  throw new Error(`Invalid schedule type: ${scheduleType}`);
}

/**
 * Extract schedule type and value from a producer config.
 *
 * @param producerConfig - Producer config with optional interval or cron
 * @returns Schedule type and value, or null if no schedule configured
 */
export function extractSchedule(
  producerConfig: { interval?: string; cron?: string }
): { type: "interval" | "cron"; value: string } | null {
  if (producerConfig.interval) {
    return { type: "interval", value: producerConfig.interval };
  }
  if (producerConfig.cron) {
    return { type: "cron", value: producerConfig.cron };
  }
  return null;
}
