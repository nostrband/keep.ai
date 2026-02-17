import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useWorkflow, useScriptRunsByWorkflowId } from "../hooks/dbScriptReads";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";
import { getWorkflowTitle } from "../lib/workflowUtils";
import { ScriptRunStatusBadge } from "./StatusBadge";

const PAGE_SIZE = 20;

export default function WorkflowScriptRunsPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: workflow } = useWorkflow(workflowId!);
  const { data: scriptRuns = [], isLoading } = useScriptRunsByWorkflowId(workflowId!);

  const visibleRuns = scriptRuns.slice(0, visibleCount);
  const hasMore = scriptRuns.length > visibleCount;

  if (!workflowId) {
    return <div>Workflow ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Workflows"
        subtitle={workflow ? `${getWorkflowTitle(workflow)} - Runs` : "Runs"}
      />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Back link */}
        <Link
          to={`/workflows/${workflowId}`}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to workflow
        </Link>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Script Runs</h2>
              <p className="text-sm text-gray-500 mt-1">
                {scriptRuns.length} run{scriptRuns.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">Loading runs...</div>
            </div>
          ) : scriptRuns.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">No script runs found</div>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRuns.map((run: any) => (
                <Link
                  key={run.id}
                  to={`/scripts/${run.script_id}/runs/${run.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">Run {run.id.slice(0, 8)}</span>
                        <ScriptRunStatusBadge
                          error={run.error}
                          endTimestamp={run.end_timestamp}
                          labels={{ error: "error", success: "completed", running: "running" }}
                        />
                        {run.retry_of && run.retry_count > 0 && (
                          <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 text-xs">
                            Retry #{run.retry_count}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Started: {new Date(run.start_timestamp).toLocaleString()}</span>
                        {run.end_timestamp && (
                          <span>Ended: {new Date(run.end_timestamp).toLocaleString()}</span>
                        )}
                        {run.cost > 0 && (
                          <span className="flex items-center gap-1">
                            <span>{(run.cost / 1000000).toFixed(2)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}

              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="cursor-pointer"
                  >
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
