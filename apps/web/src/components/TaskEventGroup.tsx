import React from "react";
import { Link } from "react-router-dom";
import { useTask } from "../hooks/dbTaskReads";
import { EventItem } from "./EventItem";
import { EventType, EventPayload, GmailApiCallEventPayload, EVENT_TYPES } from "../types/events";

// Transform Gmail API method names to simpler, user-friendly names
function transformGmailMethod(method: string): string {
  const methodMap: Record<string, string> = {
    "users.messages.list": "messages",
    "users.messages.get": "messages",
    "users.messages.attachments.get": "attachments",
    "users.history.list": "history",
    "users.threads.get": "threads",
    "users.threads.list": "threads",
    "users.getProfile": "profile"
  };
  
  return methodMap[method] || method.split('.').pop() || method;
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
  const { data: task } = useTask(taskId);

  const handleTaskMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement task menu actions (mute task, etc.)
    console.log("Task menu clicked for task:", taskId);
  };

  const taskTitle = task?.title || "Unknown Task";

  // Get task_run_id from any event (all events have task_run_id)
  const taskRunId = events.length > 0 ? events[0].content?.task_run_id : null;

  // Filter out task_run events (they are invisible markers for grouping)
  const visibleEvents = events.filter(event => event.type !== 'task_run');
  
  // Separate gmail_api_call events from other events
  const gmailEvents = visibleEvents.filter(event => event.type === EVENT_TYPES.GMAIL_API_CALL);
  const nonGmailEvents = visibleEvents.filter(event => event.type !== EVENT_TYPES.GMAIL_API_CALL);
  
  // Create consolidated gmail event if there are gmail events
  let consolidatedGmailEvent = null;
  if (gmailEvents.length > 0) {
    // Extract unique methods from all gmail events
    const uniqueMethods = Array.from(new Set(
      gmailEvents.map(event => transformGmailMethod((event.content as GmailApiCallEventPayload).method))
    ));
    
    // Create a consolidated event
    consolidatedGmailEvent = {
      id: `gmail-consolidated-${gmailEvents[0].id}`,
      type: EVENT_TYPES.GMAIL_API_CALL,
      content: {
        ...gmailEvents[0].content,
        method: `${uniqueMethods.join(', ')}`
      } as GmailApiCallEventPayload,
      timestamp: gmailEvents[0].timestamp
    };
  }
  
  // Combine non-gmail events with consolidated gmail event
  const finalEvents = [
    ...nonGmailEvents,
    ...(consolidatedGmailEvent ? [consolidatedGmailEvent] : [])
  ];
  
  // Check if this is an empty group (only task_run events)
  const isEmpty = finalEvents.length === 0;

  return (
    <div className={`mx-0 my-3 border border-gray-200 bg-gray-50 ${isEmpty ? 'rounded-lg' : 'rounded-lg'}`}>
      {/* Task Title Header */}
      {taskRunId ? (
        <Link
          to={`/tasks/${taskId}/run/${taskRunId}`}
          className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${isEmpty ? 'rounded-lg' : 'border-b border-gray-200 rounded-t-lg'} hover:bg-gray-100 cursor-pointer transition-colors duration-200`}
        >
          <div className="flex items-center flex-1 min-w-0">
            <span className="text-sm text-gray-600">
              {task?.type === "worker" ? (
                <>
                  ⚙ Working: <span className="text-gray-600">{taskTitle}</span>
                </>
              ) : (
                <>💭 Replying</>
              )}
            </span>
          </div>

          <button
            onClick={handleTaskMenuClick}
            className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="Task actions"
          >
            ···
          </button>
        </Link>
      ) : (
        <div className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${isEmpty ? 'rounded-lg' : 'border-b border-gray-200 rounded-t-lg'}`}>
          <div className="flex items-center flex-1 min-w-0">
            <span className="text-sm text-gray-600">
              {task?.type === "worker" ? (
                <>
                  ⚙ Working: <span className="text-gray-600">{taskTitle}</span>
                </>
              ) : (
                <>💭 Replying</>
              )}
            </span>
          </div>

          <button
            onClick={handleTaskMenuClick}
            className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="Task actions"
          >
            ···
          </button>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
