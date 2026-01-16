import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTask, useTaskRun } from "../hooks/dbTaskReads";
import { useScriptRun } from "../hooks/dbScriptReads";
import { EventItem } from "./EventItem";
import {
  EventType,
  EventPayload,
  GmailApiCallEventPayload,
  EVENT_TYPES,
} from "../types/events";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui";

// Transform Gmail API method names to simpler, user-friendly names
function transformGmailMethod(method: string): string {
  const methodMap: Record<string, string> = {
    "users.messages.list": "read messages",
    "users.messages.get": "read messages",
    "users.messages.attachments.get": "read attachments",
    "users.history.list": "read history",
    "users.threads.get": "read threads",
    "users.threads.list": "read threads",
    "users.getProfile": "read profile",
  };

  return methodMap[method] || method.split(".").pop() || method;
}

// Helper function to format duration into short rounded format
function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

interface TaskEvent {
  id: string;
  type: string;
  content: any;
  timestamp: string;
}

interface TaskEventGroupProps {
  taskId: string;
  events: TaskEvent[];
}

export function TaskEventGroup({ taskId, events }: TaskEventGroupProps) {
  const navigate = useNavigate();
  const { data: task } = useTask(taskId);

  // Get task_run_id or script_run_id from any event
  const taskRunId = events.length > 0 ? events[0].content?.task_run_id : null;
  const scriptRunId = events.length > 0 ? events[0].content?.script_run_id : null;

  // Fetch task run data to get metadata
  const { data: taskRun } = useTaskRun(taskRunId || "");

  // Fetch script run data if this is a script run
  const { data: scriptRun } = useScriptRun(scriptRunId || "");

  // State for auto-updating timer
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Auto-update timer if task/script is running (no end_timestamp)
  useEffect(() => {
    const run = scriptRun || taskRun;
    if (run && run.start_timestamp && !run.end_timestamp) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [taskRun, scriptRun]);

  const handleViewTask = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/tasks/${taskId}`);
  };

  const taskTitle = task?.title || `Task ${taskId.slice(0, 8)}`;

  // Use script run or task run data
  const run = scriptRun || taskRun;

  // Calculate duration
  let duration: string | null = null;
  if (run?.start_timestamp) {
    const startTime = new Date(run.start_timestamp).getTime();
    const endTime = run.end_timestamp
      ? new Date(run.end_timestamp).getTime()
      : currentTime;
    duration = formatDuration(endTime - startTime);
  }

  // Get steps count (only for task runs)
  const steps = taskRun?.steps;

  // Get cost from task_run or from events with usage.cost
  let totalCost = 0;
  
  // Cost of the task run itself
  if (taskRun?.cost != null && taskRun.cost > 0) {
    totalCost += taskRun.cost / 1000000; // It's stored as integer w/ increased precision
  }

  // Cost of tools
  const eventsWithCost = events.filter((e: any) => e.content?.usage?.cost != null);
  if (eventsWithCost.length > 0) {
    totalCost += eventsWithCost.reduce((sum: number, e: any) => sum + (e.content.usage.cost || 0), 0);
  }

  // Filter out task_run and task_run_end events (they are invisible markers for grouping)
  const visibleEvents = events.filter((event) => event.type !== "task_run" && event.type !== "task_run_end");

  // Separate gmail_api_call events from other events
  const gmailEvents = visibleEvents.filter(
    (event) => event.type === EVENT_TYPES.GMAIL_API_CALL
  );
  const nonGmailEvents = visibleEvents.filter(
    (event) => event.type !== EVENT_TYPES.GMAIL_API_CALL
  );

  // Create consolidated gmail event if there are gmail events
  let consolidatedGmailEvent = null;
  if (gmailEvents.length > 0) {
    // Extract unique methods from all gmail events
    const uniqueMethods = Array.from(
      new Set(
        gmailEvents.map((event) =>
          transformGmailMethod(
            (event.content as GmailApiCallEventPayload).method
          )
        )
      )
    );

    // Create a consolidated event
    consolidatedGmailEvent = {
      id: `gmail-consolidated-${gmailEvents[0].id}`,
      type: EVENT_TYPES.GMAIL_API_CALL,
      content: {
        ...gmailEvents[0].content,
        method: `${uniqueMethods.join(", ")}`,
      } as GmailApiCallEventPayload,
      timestamp: gmailEvents[0].timestamp,
    };
  }

  // Combine non-gmail events with consolidated gmail event
  const finalEvents = [
    ...nonGmailEvents,
    ...(consolidatedGmailEvent ? [consolidatedGmailEvent] : []),
  ];

  // Check if this is an empty group (only task_run events)
  const isEmpty = finalEvents.length === 0;

  return (
    <div
      className={`mx-0 my-3 border border-gray-200 bg-gray-50 ${
        isEmpty ? "rounded-lg" : "rounded-lg"
      }`}
    >
      {/* Task Title Header */}
      {taskRunId || scriptRunId ? (
        <Link
          to={
            taskRunId
              ? `/tasks/${taskId}/run/${taskRunId}`
              : `/scripts/${scriptRun?.script_id}/runs/${scriptRunId}`
          }
          className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${
            isEmpty ? "rounded-lg" : "border-b border-gray-200 rounded-t-lg"
          } hover:bg-gray-100 cursor-pointer transition-colors duration-200`}
        >
          <div className="flex items-center flex-1 min-w-0 gap-2">
            <span className="text-sm text-gray-600">
              {task?.type === "worker" || task?.type === "planner" ? (
                <>
                  ⚙ {task?.type === "worker" ? "Working" : "Planning"}:{" "}
                  <span className="text-gray-600">{taskTitle}</span>
                </>
              ) : (
                <>💭 Replying</>
              )}
            </span>
            {/* Metadata: time, steps, cost */}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {duration && (
                <span className="flex items-center gap-1">
                  <span>🕐</span>
                  <span>{duration}</span>
                </span>
              )}
              {steps != null && (
                <span className="flex items-center gap-1">
                  <span>📈</span>
                  <span>{steps}</span>
                </span>
              )}
              {totalCost > 0 && (
                <span className="flex items-center gap-1">
                  <span>💵</span>
                  <span>{totalCost.toFixed(2)}</span>
                </span>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                aria-label="Task actions"
              >
                ···
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleViewTask}>
                <span className="mr-2">👁️</span>
                View task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Link>
      ) : (
        <div
          className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${
            isEmpty ? "rounded-lg" : "border-b border-gray-200 rounded-t-lg"
          }`}
        >
          <div className="flex items-center flex-1 min-w-0 gap-2">
            <span className="text-sm text-gray-600">
              {task?.type === "worker" || task?.type === "planner" ? (
                <>
                  ⚙ {task?.type === "worker" ? "Working" : "Planning"}:{" "}
                  <span className="text-gray-600">{taskTitle}</span>
                </>
              ) : (
                <>💭 Replying</>
              )}
            </span>
            {/* Metadata: time, steps, cost */}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {duration && (
                <span className="flex items-center gap-1">
                  <span>🕐</span>
                  <span>{duration}</span>
                </span>
              )}
              {steps != null && (
                <span className="flex items-center gap-1">
                  <span>📈</span>
                  <span>{steps}</span>
                </span>
              )}
              {totalCost > 0 && (
                <span className="flex items-center gap-1">
                  <span>💵</span>
                  <span>{totalCost.toFixed(2)}</span>
                </span>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                aria-label="Task actions"
              >
                ···
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleViewTask}>
                <span className="mr-2">👁️</span>
                View task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Events List - only show if there are visible events */}
      {!isEmpty && (
        <div className="p-2 space-y-1">
          {finalEvents.map((event) => (
            <EventItem
              key={event.id}
              type={event.type as EventType}
              content={event.content as EventPayload}
              timestamp={event.timestamp}
              usage={(event.content as any)?.usage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
