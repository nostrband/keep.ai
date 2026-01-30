import React from "react";
import { useParams, Link } from "react-router-dom";
import { useTask, useTaskRuns } from "../hooks/dbTaskReads";
import { useLatestScriptByTaskId, useWorkflowByTaskId } from "../hooks/dbScriptReads";
import { useChat } from "../hooks/dbChatReads";
import { useUpdateTask, usePauseTask } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";
import { Response } from "../ui/components/ai-elements/response";
import { TaskStatusBadge, WorkflowStatusBadge, TaskRunStatusBadge } from "./StatusBadge";
import { useAutoHidingMessage } from "../hooks/useAutoHidingMessage";
import { getWorkflowTitle } from "../lib/workflowUtils";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id!);
  const { data: taskRuns = [], isLoading: isLoadingRuns } = useTaskRuns(id!);
  const { data: latestScript } = useLatestScriptByTaskId(id!);
  const { data: workflow } = useWorkflowByTaskId(id!);
  const { data: chat } = useChat(task?.chat_id || "");
  const success = useAutoHidingMessage({ duration: 3000 });
  const warning = useAutoHidingMessage({ duration: 3000 });

  const updateTaskMutation = useUpdateTask();
  const pauseTaskMutation = usePauseTask();

  // Helper to show warning (clears success message first)
  const showWarning = (message: string) => {
    success.clear();
    warning.show(message);
  };

  const handleRunNow = async () => {
    if (!task) return;

    // Check if the latest run is still working
    if (taskRuns.length > 0) {
      const latestRun = taskRuns[0]; // taskRuns are ordered by start_timestamp DESC
      if (!latestRun.end_timestamp) {
        showWarning("Already working");
        return;
      }
    }

    // Clear any previous messages
    warning.clear();
    success.clear();

    // Update task timestamp to now (in seconds)
    const nowTimestamp = Math.floor(Date.now() / 1000);
    updateTaskMutation.mutate({
      taskId: task.id,
      timestamp: nowTimestamp,
    }, {
      onSuccess: () => {
        success.show("Task will run soon");
      },
      onError: () => {
        showWarning("Failed to restart task");
      }
    });
  };

  const handlePause = async () => {
    if (!task) return;

    // Clear any previous messages
    warning.clear();
    success.clear();

    pauseTaskMutation.mutate({
      taskId: task.id,
    }, {
      onSuccess: () => {
        success.show("Task paused");
      },
      onError: () => {
        showWarning("Failed to pause task");
      }
    });
  };

  if (!id) {
    return <div>Task ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Tasks"
        subtitle={task ? (task.title || (task.type === 'planner' ? 'Planner' : `Task ${task.id.slice(0, 8)}`)) : undefined}
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
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {task.title || (task.type === 'planner' ? 'Planner' : `Task ${task.id.slice(0, 8)}`)}
                  </h2>
                  <TaskStatusBadge state={task.state} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    onClick={handleRunNow}
                    disabled={updateTaskMutation.isPending}
                    size="sm"
                    variant="outline"
                    className="cursor-pointer"
                  >
                    {updateTaskMutation.isPending ? "Running..." : "Run now"}
                  </Button>
                  {warning.message && (
                    <div className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                      {warning.message}
                    </div>
                  )}
                  {success.message && (
                    <div className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                      {success.message}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Scheduled Time</h3>
                    <p className="text-gray-900">
                      {task.timestamp > 0 ? new Date(task.timestamp * 1000).toLocaleString() : "Not scheduled"}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Task ID</h3>
                    <p className="text-gray-900 font-mono text-sm">{task.id}</p>
                  </div>
                </div>

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

            {/* Task Asks (Spec 10: only asks is shown now) */}
            {task.asks && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Asks</h2>
                <div className="prose prose-sm max-w-none">
                  <Response>{task.asks}</Response>
                </div>
              </div>
            )}

            {/* Workflow Section */}
            {workflow && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Workflow</h2>
                <Link
                  to={`/workflows/${workflow.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">{getWorkflowTitle(workflow)}</span>
                        <WorkflowStatusBadge status={workflow.status} />
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        {workflow.cron && <span>Cron: {workflow.cron}</span>}
                        {workflow.events && <span>Events: {workflow.events}</span>}
                        <span>Created: {new Date(workflow.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Script Section for Planner Tasks */}
            {task.type === 'planner' && latestScript && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Script</h2>
                <Link
                  to={`/scripts/${latestScript.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">Script {latestScript.id.slice(0, 8)}</span>
                        <Badge variant="outline">v{latestScript.major_version}.{latestScript.minor_version}</Badge>
                      </div>
                      {latestScript.change_comment && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {latestScript.change_comment}
                        </p>
                      )}
                      <div className="text-xs text-gray-500">
                        Updated: {new Date(latestScript.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Chats Section */}
            {task.chat_id && chat && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Chats</h2>
                <Link
                  to={`/chats/${task.chat_id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">Chat {chat.id.slice(0, 8)}</span>
                      </div>
                      {chat.first_message && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {chat.first_message}
                        </p>
                      )}
                      <div className="text-xs text-gray-500">
                        Last updated: {new Date(chat.updated_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Task Runs List */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Task Runs</h2>
              {isLoadingRuns ? (
                <div className="flex items-center justify-center py-4">
                  <div>Loading task runs...</div>
                </div>
              ) : taskRuns.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <div className="text-gray-500">No task runs found</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {taskRuns.map((run) => (
                    <Link
                      key={run.id}
                      to={`/tasks/${task.id}/run/${run.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">Run {run.id.slice(0, 8)}</span>
                            <TaskRunStatusBadge state={run.state || (run.error ? 'error' : 'pending')} />
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Started: {new Date(run.start_timestamp).toLocaleString()}</span>
                            {run.end_timestamp && (
                              <span>Ended: {new Date(run.end_timestamp).toLocaleString()}</span>
                            )}
                            {run.reason && <span>Reason: {run.reason}</span>}
                            {run.steps > 0 && <span>Steps: {run.steps}</span>}
                            {(run.input_tokens > 0 || run.output_tokens > 0) && (
                              <span>Tokens: {(run.input_tokens || 0) + (run.output_tokens || 0)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}