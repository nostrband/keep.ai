import React from "react";
import { useParams, Link } from "react-router-dom";
import { useScript, useScriptVersions, useScriptRuns } from "../hooks/dbScriptReads";
import { useTaskRuns } from "../hooks/dbTaskReads";
import { useUpdateTask } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import {
  Badge,
  Button,
} from "../ui";
import { ScriptRunStatusBadge } from "./StatusBadge";
import { useAutoHidingMessage } from "../hooks/useAutoHidingMessage";

export default function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: script, isLoading } = useScript(id!);
  const { data: versions = [], isLoading: isLoadingVersions } = useScriptVersions(script?.task_id || "");
  const { data: scriptRuns = [], isLoading: isLoadingRuns } = useScriptRuns(id!);
  const { data: taskRuns = [] } = useTaskRuns(script?.task_id || "");
  const success = useAutoHidingMessage({ duration: 3000 });
  const warning = useAutoHidingMessage({ duration: 3000 });

  const updateTaskMutation = useUpdateTask();

  // Helper to show warning (clears success message first)
  const showWarning = (message: string) => {
    success.clear();
    warning.show(message);
  };

  const handleRunNow = async () => {
    if (!script) return;

    // Check if the latest run is active
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
      taskId: script.task_id,
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

  if (!id) {
    return <div>Script ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Scripts"
        subtitle={script ? `Script ${script.id.slice(0, 8)}` : undefined}
      />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading script...</div>
          </div>
        ) : !script ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Script not found</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Script Metadata */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Script {script.id.slice(0, 8)}
                  </h2>
                  <Badge variant="outline">Version {script.major_version}.{script.minor_version}</Badge>
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

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Task ID</h3>
                    <Link 
                      to={`/tasks/${script.task_id}`}
                      className="text-blue-600 hover:text-blue-800 underline font-mono text-sm"
                    >
                      {script.task_id.slice(0, 16)}...
                    </Link>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Updated</h3>
                    <p className="text-gray-900">{new Date(script.timestamp).toLocaleString()}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Script ID</h3>
                    <p className="text-gray-900 font-mono text-sm">{script.id}</p>
                  </div>
                </div>

                {script.change_comment && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Change Comment</h3>
                    <p className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">{script.change_comment}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Script Code */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Code</h2>
              <div className="bg-gray-50 p-4 rounded border border-gray-200">
                <pre className="text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                  {script.code}
                </pre>
              </div>
            </div>

            {/* Version History */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Version History</h2>
              {isLoadingVersions ? (
                <div className="flex items-center justify-center py-4">
                  <div>Loading versions...</div>
                </div>
              ) : versions.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <div className="text-gray-500">No version history found</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {versions.map((version: any) => (
                    <Link
                      key={version.id}
                      to={`/scripts/${version.id}`}
                      className={`block p-4 border rounded-lg transition-all ${
                        version.id === script.id
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">Version {version.major_version}.{version.minor_version}</span>
                            {version.id === script.id && (
                              <Badge variant="default">Current</Badge>
                            )}
                          </div>
                          {version.change_comment && (
                            <p className="text-sm text-gray-600 mb-2 line-clamp-1">
                              {version.change_comment}
                            </p>
                          )}
                          <div className="text-xs text-gray-500">
                            Updated: {new Date(version.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Script Runs */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Script Runs</h2>
              {isLoadingRuns ? (
                <div className="flex items-center justify-center py-4">
                  <div>Loading runs...</div>
                </div>
              ) : scriptRuns.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <div className="text-gray-500">No script runs found</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {scriptRuns.map((run: any) => (
                    <Link
                      key={run.id}
                      to={`/scripts/${script.id}/runs/${run.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">Run {run.id.slice(0, 8)}</span>
                            <ScriptRunStatusBadge error={run.error} endTimestamp={run.end_timestamp} />
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Started: {new Date(run.start_timestamp).toLocaleString()}</span>
                            {run.end_timestamp && (
                              <span>Ended: {new Date(run.end_timestamp).toLocaleString()}</span>
                            )}
                          </div>
                          {run.error && (
                            <p className="text-sm text-red-600 mt-2 line-clamp-2">
                              {run.error}
                            </p>
                          )}
                          {run.result && !run.error && (
                            <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                              Result: {run.result}
                            </p>
                          )}
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
