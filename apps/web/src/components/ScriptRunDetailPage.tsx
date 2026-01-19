import React from "react";
import { useParams, Link } from "react-router-dom";
import { useScriptRun, useScript } from "../hooks/dbScriptReads";
import SharedHeader from "./SharedHeader";
import {
  Badge,
} from "../ui";

export default function ScriptRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { data: run, isLoading } = useScriptRun(runId!);
  const { data: script, isLoading: isLoadingScript } = useScript(run?.script_id || "");

  if (!id || !runId) {
    return <div>Script run ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Scripts"
        subtitle={run ? `Run ${run.id.slice(0, 8)}` : undefined}
      />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading script run...</div>
          </div>
        ) : !run ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Script run not found</div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Run {run.id.slice(0, 8)}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {run.error ? (
                    <Badge variant="destructive">Error</Badge>
                  ) : run.end_timestamp ? (
                    <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>
                  ) : (
                    <Badge variant="secondary">Running</Badge>
                  )}
                  {/* Show retry badge if this is a retry run */}
                  {run.retry_of && run.retry_count > 0 && (
                    <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50">
                      Retry #{run.retry_count}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Script ID</h3>
                  <Link 
                    to={`/scripts/${run.script_id}`}
                    className="text-blue-600 hover:text-blue-800 underline font-mono text-sm"
                  >
                    {run.script_id.slice(0, 16)}...
                  </Link>
                </div>

                {script && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Task ID</h3>
                    <Link 
                      to={`/tasks/${script.task_id}`}
                      className="text-blue-600 hover:text-blue-800 underline font-mono text-sm"
                    >
                      {script.task_id.slice(0, 16)}...
                    </Link>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Started</h3>
                  <p className="text-gray-900">{new Date(run.start_timestamp).toLocaleString()}</p>
                </div>

                {run.end_timestamp && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Ended</h3>
                    <p className="text-gray-900">{new Date(run.end_timestamp).toLocaleString()}</p>
                  </div>
                )}

                {run.end_timestamp && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Duration</h3>
                    <p className="text-gray-900">
                      {Math.round((new Date(run.end_timestamp).getTime() - new Date(run.start_timestamp).getTime()) / 1000)} seconds
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Run ID</h3>
                  <p className="text-gray-900 font-mono text-sm">{run.id}</p>
                </div>

                {/* Show cost if any (stored in microdollars, display as dollars) */}
                {run.cost > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Cost</h3>
                    <p className="text-gray-900 flex items-center gap-1">
                      <span>💵</span>
                      <span>{(run.cost / 1000000).toFixed(2)}</span>
                    </p>
                  </div>
                )}

                {/* Show link to original failed run if this is a retry */}
                {run.retry_of && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Retry of Run</h3>
                    <Link
                      to={`/scripts/${run.script_id}/runs/${run.retry_of}`}
                      className="text-blue-600 hover:text-blue-800 underline font-mono text-sm"
                    >
                      {run.retry_of.slice(0, 16)}...
                    </Link>
                    <p className="text-xs text-gray-500 mt-1">
                      This is retry #{run.retry_count} of the original failed run
                    </p>
                  </div>
                )}
              </div>

              {run.error && (
                <div>
                  <h3 className="text-sm font-medium text-red-700 mb-2">Error</h3>
                  <pre className="text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200 text-sm font-mono overflow-x-auto">
                    {run.error}
                  </pre>
                </div>
              )}

              {run.result && !run.error && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Result</h3>
                  <pre className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200 text-sm font-mono overflow-x-auto">
                    {run.result}
                  </pre>
                </div>
              )}

              {run.logs && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Logs</h3>
                  <pre className="text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200 text-sm font-mono overflow-x-auto">
                    {run.logs}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
