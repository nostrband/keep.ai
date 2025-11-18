import React from "react";
import { useParams, Link } from "react-router-dom";
import { useTask, useTaskState, useTaskRuns } from "../hooks/dbTaskReads";
import SharedHeader from "./SharedHeader";
import {
  Badge,
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
                              {run.state || 'pending'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Started: {new Date(run.start_timestamp).toLocaleString()}</span>
                            {run.end_timestamp && (
                              <span>Ended: {new Date(run.end_timestamp).toLocaleString()}</span>
                            )}
                            {run.reason && <span>Reason: {run.reason}</span>}
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