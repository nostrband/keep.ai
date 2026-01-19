import React from "react";
import { Link } from "react-router-dom";
import { useTasks } from "../hooks/dbTaskReads";
import SharedHeader from "./SharedHeader";
import { TaskStatusBadge } from "./StatusBadge";

export default function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks(true); // Include finished tasks

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Tasks" />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading tasks...</div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">No tasks found</div>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <Link
                key={task.id}
                to={`/tasks/${task.id}`}
                className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-gray-900">
                        {task.title || (task.type === 'planner' ? 'Planner' : `Task ${task.id.slice(0, 8)}`)}
                      </h3>
                      <TaskStatusBadge state={task.state} defaultLabel="Pending" />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        Scheduled: {task.timestamp > 0 ? new Date(task.timestamp * 1000).toLocaleString() : "Not scheduled"}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}