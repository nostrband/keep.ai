/**
 * Schedule utilities for producer scheduling (exec-13).
 *
 * Provides interval parsing, next run time computation, cron formatting,
 * and denormalization helpers.
 */

import { Cron } from "croner";
import type { WorkflowConfig } from "./workflow-validator";

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

/**
 * Parse cron expression to human-readable schedule string.
 * This function never throws - it returns the raw cron string on any error.
 */
export function formatCronSchedule(cron?: string): string {
  if (!cron) return "Not scheduled";

  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every minute
    if (minute === "*" && hour === "*" && dayOfMonth === "*" &&
        month === "*" && dayOfWeek === "*") {
      return "Every minute";
    }

    // Step expressions: */N minutes (all other fields *)
    const minuteStep = minute.match(/^\*\/(\d+)$/);
    if (minuteStep && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every ${minuteStep[1]} minutes`;
    }

    // Step expressions: 0 */N hours (minute=0, all other fields *)
    const hourStep = hour.match(/^\*\/(\d+)$/);
    if (minute === "0" && hourStep && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every ${hourStep[1]} hours`;
    }

    // Every hour at specific minute
    if (minute !== "*" && hour === "*") {
      const minuteNum = parseInt(minute, 10);
      if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 59) {
        return cron;
      }
      return `Every hour at :${minuteNum.toString().padStart(2, "0")}`;
    }

    // Daily at specific time
    if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);
      if (isNaN(hourNum) || isNaN(minuteNum) ||
          minuteNum < 0 || minuteNum > 59 ||
          hourNum < 0 || hourNum > 23) {
        return cron;
      }
      const period = hourNum >= 12 ? "PM" : "AM";
      const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
      return `Every day at ${displayHour}:${minuteNum.toString().padStart(2, "0")} ${period}`;
    }

    // Weekly on specific day
    if (dayOfWeek !== "*" && dayOfMonth === "*") {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayNum = parseInt(dayOfWeek, 10);
      if (!isNaN(dayNum) && (dayNum < 0 || dayNum > 7)) {
        return cron;
      }
      const dayName = !isNaN(dayNum) ? (days[dayNum % 7] || dayOfWeek) : dayOfWeek;
      if (minute !== "*" && hour !== "*") {
        const hourNum = parseInt(hour, 10);
        const minuteNum = parseInt(minute, 10);
        if (isNaN(hourNum) || isNaN(minuteNum) ||
            minuteNum < 0 || minuteNum > 59 ||
            hourNum < 0 || hourNum > 23) {
          return cron;
        }
        const period = hourNum >= 12 ? "PM" : "AM";
        const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
        return `Every ${dayName} at ${displayHour}:${minuteNum.toString().padStart(2, "0")} ${period}`;
      }
      return `Every ${dayName}`;
    }

    return cron;
  } catch {
    return cron;
  }
}

/**
 * Convert an interval string to an equivalent cron expression.
 * Cron minimum resolution is per-minute, so sub-minute intervals become "* * * * *".
 */
export function intervalToCron(interval: string): string {
  const ms = parseInterval(interval);
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) return "* * * * *";
  if (minutes === 1) return "* * * * *";
  if (minutes < 60) return `*/${minutes} * * * *`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "0 * * * *";
  if (hours < 24) return `0 */${hours} * * *`;

  return "0 0 * * *";
}

/**
 * Get the most-frequent producer schedule as a cron string.
 * Picks the producer with the smallest interval.
 * Returns "" if no producers have schedules.
 */
export function getMostFrequentProducerCron(
  producers: WorkflowConfig["producers"]
): string {
  let smallestMs = Infinity;
  let smallestCron = "";

  for (const [, producer] of Object.entries(producers)) {
    const schedule = extractSchedule(producer.schedule);
    if (!schedule) continue;

    let ms: number;
    if (schedule.type === "interval") {
      ms = parseInterval(schedule.value);
    } else {
      // Cron: use croner to estimate interval
      try {
        const cron = new Cron(schedule.value);
        const next1 = cron.nextRun();
        const next2 = cron.nextRuns(2);
        if (next1 && next2.length >= 2) {
          ms = next2[1].getTime() - next2[0].getTime();
        } else {
          ms = Infinity;
        }
      } catch {
        continue;
      }
    }

    if (ms < smallestMs) {
      smallestMs = ms;
      if (schedule.type === "interval") {
        smallestCron = intervalToCron(schedule.value);
      } else {
        smallestCron = schedule.value;
      }
    }
  }

  return smallestCron;
}
