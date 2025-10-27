import React from "react";
import { useParams, Link } from "react-router-dom";
import { useTask } from "../hooks/dbTaskReads";
import SharedHeader from "./SharedHeader";
import {
  Badge,
} from "../ui";

const getStatusBadge = (task: any) => {
  if (task.state === "finished") {
    return <Badge variant="default" className="bg-green-100 text-green-800">Finished</Badge>;
  } else if (task.state === "error") {
    return <Badge variant="destructive">Error</Badge>;
  } else if (task.reply === "") {
    return <Badge variant="secondary">Pending</Badge>;
  } else {
    return <Badge variant="outline">Unknown</Badge>;
  }
};

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id!);

  if (!id) {
    return <div>Task ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Tasks"
        subtitle={task ? (task.title || `Task ${task.id.slice(0, 8)}`) : undefined}
      />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading task...</div>
          </div>
        ) : !task ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Task not found</div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {task.title || `Task ${task.id.slice(0, 8)}`}
                </h2>
                {getStatusBadge(task)}
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Task Description</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{task.task}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Scheduled Time</h3>
                  <p className="text-gray-900">
                    {task.timestamp > 0 ? new Date(task.timestamp * 1000).toLocaleString() : "Not scheduled"}
                  </p>
                </div>

                {task.cron && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Cron Schedule</h3>
                    <p className="text-gray-900 font-mono text-sm">{task.cron}</p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Task ID</h3>
                  <p className="text-gray-900 font-mono text-sm">{task.id}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">User ID</h3>
                  <p className="text-gray-900 font-mono text-sm">{task.user_id}</p>
                </div>
              </div>

              {task.thread_id && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Related Thread</h3>
                  <Link
                    to={`/threads/${task.thread_id}`}
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    View Thread: {task.thread_id.slice(0, 8)}...
                  </Link>
                </div>
              )}

              {task.reply && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Reply</h3>
                  <p className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">{task.reply}</p>
                </div>
              )}

              {task.error && (
                <div>
                  <h3 className="text-sm font-medium text-red-700 mb-2">Error</h3>
                  <p className="text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200">{task.error}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}