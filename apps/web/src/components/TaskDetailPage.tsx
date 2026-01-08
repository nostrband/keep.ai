import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTask, useTaskState, useTaskRuns } from "../hooks/dbTaskReads";
import { useLatestScriptByTaskId } from "../hooks/dbScriptReads";
import { useUpdateTask } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import {
  Badge,
  Button,
} from "../ui";
import { Response } from "../ui/components/ai-elements/response";

const getStatusBadge = (task: any) => {
  if (task.state === "finished") {
    return <Badge variant="default" className="bg-green-100 text-green-800">Finished</Badge>;
  } else if (task.state === "error") {
    return <Badge variant="destructive">Error</Badge>;
  } else if (task.state === "wait") {
    return <Badge variant="secondary">Waiting</Badge>;
  } else if (task.state === "asks") {
    return <Badge variant="secondary">Asking</Badge>;
  } else {
    return <Badge variant="outline">Unknown</Badge>;
  }
};

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id!);
  const { data: taskState, isLoading: isLoadingState } = useTaskState(id!);
  const { data: taskRuns = [], isLoading: isLoadingRuns } = useTaskRuns(id!);
  const { data: latestScript } = useLatestScriptByTaskId(id!);
  const [warning, setWarning] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  
  const updateTaskMutation = useUpdateTask();

  const handleRunNow = async () => {
    if (!task) return;
    
    // Check if the latest run was created less than 5 minutes ago
    if (taskRuns.length > 0) {
      const latestRun = taskRuns[0]; // taskRuns are ordered by start_timestamp DESC
      const latestRunTime = new Date(latestRun.start_timestamp).getTime();
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      
      if (latestRunTime > fiveMinutesAgo) {
        setWarning("Can't restart too often");
        setSuccessMessage("");
        setTimeout(() => setWarning(""), 3000); // Clear warning after 3 seconds
        return;
      }
    }
    
    // Clear any previous messages
    setWarning("");
    setSuccessMessage("");
    
    // Update task timestamp to now (in seconds)
    const nowTimestamp = Math.floor(Date.now() / 1000);
    updateTaskMutation.mutate({
      taskId: task.id,
      timestamp: nowTimestamp,
    }, {
      onSuccess: () => {
        setSuccessMessage("Task will run soon");
        setTimeout(() => setSuccessMessage(""), 3000); // Clear success message after 3 seconds
      },
      onError: () => {
        setWarning("Failed to restart task");
        setTimeout(() => setWarning(""), 3000);
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
        subtitle={task ? (task.title || (task.type === 'router' ? 'Router' : task.type === 'replier' ? 'Replier' : `Task ${task.id.slice(0, 8)}`)) : undefined}
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
                    {task.title || (task.type === 'router' ? 'Router' : task.type === 'replier' ? 'Replier' : `Task ${task.id.slice(0, 8)}`)}
                  </h2>
                  {getStatusBadge(task)}
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
                  {warning && (
                    <div className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                      {warning}
                    </div>
                  )}
                  {successMessage && (
                    <div className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                      {successMessage}
                    </div>
                  )}
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

            {/* Task State Information */}
            {taskState && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Task State</h2>
                <div className="space-y-4">
                  {taskState.goal && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Goal</h3>
                      <div className="prose prose-sm max-w-none">
                        <Response>{taskState.goal}</Response>
                      </div>
                    </div>
                  )}
                  {taskState.notes && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Notes</h3>
                      <div className="prose prose-sm max-w-none">
                        <Response>{taskState.notes}</Response>
                      </div>
                    </div>
                  )}
                  {taskState.plan && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Plan</h3>
                      <div className="prose prose-sm max-w-none">
                        <Response>{taskState.plan}</Response>
                      </div>
                    </div>
                  )}
                  {taskState.asks && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Asks</h3>
                      <div className="prose prose-sm max-w-none">
                        <Response>{taskState.asks}</Response>
                      </div>
                    </div>
                  )}
                </div>
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
                        <Badge variant="outline">v{latestScript.version}</Badge>
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
                            <Badge variant={run.state === 'done' ? 'default' : run.error ? 'destructive' : 'secondary'}>
                              {run.state || run.error || 'pending'}
                            </Badge>
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