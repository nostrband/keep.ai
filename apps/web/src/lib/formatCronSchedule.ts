/**
 * Parse cron expression to human-readable schedule string.
 * This function never throws - it returns the raw cron string on any error.
 */
export function formatCronSchedule(cron?: string): string {
  if (!cron) return "Not scheduled";

  try {
    // Basic cron parsing for common patterns
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron; // Return raw if not standard cron

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every minute
    if (minute === "*" && hour === "*") {
      return "Every minute";
    }

    // Every hour at specific minute
    if (minute !== "*" && hour === "*") {
      const minuteNum = parseInt(minute, 10);
      if (isNaN(minuteNum)) {
        return cron; // Return raw cron for invalid format
      }
      return `Every hour at :${minuteNum.toString().padStart(2, "0")}`;
    }

    // Daily at specific time
    if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);
      if (isNaN(hourNum) || isNaN(minuteNum)) {
        return cron; // Return raw cron for invalid format
      }
      const period = hourNum >= 12 ? "PM" : "AM";
      const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
      return `Every day at ${displayHour}:${minuteNum.toString().padStart(2, "0")} ${period}`;
    }

    // Weekly on specific day
    if (dayOfWeek !== "*" && dayOfMonth === "*") {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayNum = parseInt(dayOfWeek, 10);
      const dayName = !isNaN(dayNum) ? (days[dayNum] || dayOfWeek) : dayOfWeek;
      if (minute !== "*" && hour !== "*") {
        const hourNum = parseInt(hour, 10);
        const minuteNum = parseInt(minute, 10);
        if (isNaN(hourNum) || isNaN(minuteNum)) {
          return cron; // Return raw cron for invalid format
        }
        const period = hourNum >= 12 ? "PM" : "AM";
        const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
        return `Every ${dayName} at ${displayHour}:${minuteNum.toString().padStart(2, "0")} ${period}`;
      }
      return `Every ${dayName}`;
    }

    // Return raw cron for complex patterns
    return cron;
  } catch {
    // Return raw cron on any error to prevent UI crashes
    return cron;
  }
}
