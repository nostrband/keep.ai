import React from "react";
import { useTask } from "../hooks/dbTaskReads";
import { EventItem } from "./EventItem";
import { EventType, EventPayload } from "../types/events";

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

  // Filter out task_run events (they are invisible markers for grouping)
  const visibleEvents = events.filter(event => event.type !== 'task_run');
  
  // Check if this is an empty group (only task_run events)
  const isEmpty = visibleEvents.length === 0;

  return (
    <div className={`mx-0 my-3 border border-gray-200 bg-gray-50 ${isEmpty ? 'rounded-lg' : 'rounded-lg'}`}>
      {/* Task Title Header */}
      <div className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${isEmpty ? 'rounded-lg' : 'border-b border-gray-200 rounded-t-lg'}`}>
        <div className="flex items-center flex-1 min-w-0">
          <span className="text-sm text-gray-600 font-medium">
            {task?.type === "worker" ? (
              <>
                ⚙ Working: <span className="text-gray-800">{taskTitle}</span>
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

      {/* Events List - only show if there are visible events */}
      {!isEmpty && (
        <div className="p-2 space-y-1">
          {visibleEvents.map((event) => (
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
