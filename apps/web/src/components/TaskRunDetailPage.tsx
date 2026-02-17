import React from "react";
import { useParams, Link } from "react-router-dom";
import { useTask, useTaskRun } from "../hooks/dbTaskReads";
import SharedHeader from "./SharedHeader";
import { Response } from "../ui/components/ai-elements/response";
import { TaskRunStatusBadge } from "./StatusBadge";

export default function TaskRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { data: task, isLoading: isLoadingTask } = useTask(id!);
  const { data: taskRun, isLoading: isLoadingRun } = useTaskRun(runId!);

  if (!id || !runId) {
    return <div>Task ID or Run ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Task Run"
        subtitle={`${
          task
            ? task.title ||
              (task.type === "planner"
                ? "Planner"
                : `Task ${task.id.slice(0, 8)}`)
            : "Loading..."
        } - Run ${runId.slice(0, 8)}`}
      />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoadingTask || isLoadingRun ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading...</div>
          </div>
        ) : !task || !taskRun ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Task or task run not found</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Task Information Header */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Link
                    to={`/tasks/${task.id}`}
                    className="text-lg font-semibold text-blue-600 hover:text-blue-800 underline"
                  >
                    {task.title ||
                      (task.type === "planner"
                        ? "Planner"
                        : `Task ${task.id.slice(0, 8)}`)}
                  </Link>
                  <p className="text-sm text-gray-600 mt-1">
                    Task ID: {task.id}
                  </p>
                </div>
              </div>
            </div>

            {/* Task Run Details */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Task Run {taskRun.id.slice(0, 8)}
                  </h2>
                  <TaskRunStatusBadge state={taskRun.state} />
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Run ID
                    </h3>
                    <p className="text-gray-900 font-mono text-sm">
                      {taskRun.id}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Type
                    </h3>
                    <p className="text-gray-900">{taskRun.type || "N/A"}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Start Time
                    </h3>
                    <p className="text-gray-900">
                      {taskRun.start_timestamp
                        ? new Date(taskRun.start_timestamp).toLocaleString()
                        : "N/A"}
                    </p>
                  </div>

                  {taskRun.end_timestamp && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">
                        End Time
                      </h3>
                      <p className="text-gray-900">
                        {new Date(taskRun.end_timestamp).toLocaleString()}
                      </p>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Reason
                    </h3>
                    <p className="text-gray-900">{taskRun.reason || "N/A"}</p>
                  </div>

                  {taskRun.model && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">
                        Model
                      </h3>
                      <p className="text-gray-900">{taskRun.model}</p>
                    </div>
                  )}

                  {taskRun.steps > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">
                        Steps
                      </h3>
                      <p className="text-gray-900">{taskRun.steps}</p>
                    </div>
                  )}

                  {taskRun.run_sec > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">
                        Runtime
                      </h3>
                      <p className="text-gray-900">{taskRun.run_sec} seconds</p>
                    </div>
                  )}
                </div>

                {/* Token Usage */}
                {(taskRun.input_tokens > 0 ||
                  taskRun.output_tokens > 0 ||
                  taskRun.cached_tokens > 0) && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                      Token Usage
                    </h3>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="text-center p-3 bg-gray-50 rounded">
                        <div className="font-medium text-gray-900">
                          {taskRun.input_tokens}
                        </div>
                        <div className="text-gray-600">Input tokens</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded">
                        <div className="font-medium text-gray-900">
                          {taskRun.cached_tokens}
                        </div>
                        <div className="text-gray-600">Cached input tokens</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded">
                        <div className="font-medium text-gray-900">
                          {taskRun.output_tokens}
                        </div>
                        <div className="text-gray-600">Output tokens</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TODO v2: re-enable structured asks display */}

                {/* Inbox Content */}
                {taskRun.inbox && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Inbox
                    </h3>
                    <div className="prose prose-sm max-w-none bg-gray-50 p-3 rounded">
                      <Response>{taskRun.inbox}</Response>
                    </div>
                  </div>
                )}

                {/* TODO v2: re-enable structured asks display */}

                {/* Reply and Error */}
                {taskRun.reply && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Reply
                    </h3>
                    <p className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                      {taskRun.reply}
                    </p>
                  </div>
                )}

                {taskRun.error && (
                  <div>
                    <h3 className="text-sm font-medium text-red-700 mb-2">
                      Error
                    </h3>
                    <p className="text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200">
                      {taskRun.error}
                    </p>
                  </div>
                )}

                {taskRun.logs && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Logs
                    </h3>
                    <pre className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200 text-sm font-mono overflow-x-auto">
                      {taskRun.logs}
                    </pre>
                  </div>
                )}

                {/* Link to Thread */}
                {taskRun.thread_id && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      Related Thread
                    </h3>
                    <Link
                      to={`/threads/${taskRun.thread_id}`}
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      View Thread: {taskRun.thread_id.slice(0, 8)}...
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
