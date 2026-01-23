import { Workflow } from "packages/db/dist";
import { WorkflowStatusBadge } from "./StatusBadge";

interface WorkflowInfoBoxProps {
  workflow: Workflow;
  onClick?: () => void;
}

/**
 * Parse cron expression to human-readable schedule string.
 */
export function formatCronSchedule(cron?: string): string {
  if (!cron) return "Not scheduled";

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
    return `Every hour at :${minute.padStart(2, "0")}`;
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
}

/**
 * Workflow info box for displaying workflow context on chat pages.
 * Tappable - navigates to workflow hub when clicked.
 */
export function WorkflowInfoBox({ workflow, onClick }: WorkflowInfoBoxProps) {
  const schedule = formatCronSchedule(workflow.cron);

  return (
    <button
      onClick={onClick}
      className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-left border border-gray-200 cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span>📋</span>
        <span className="font-medium text-gray-900 truncate">
          {workflow.title || "New workflow"}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
        <WorkflowStatusBadge status={workflow.status} />
        <span>·</span>
        <span>{schedule}</span>
      </div>
    </button>
  );
}
