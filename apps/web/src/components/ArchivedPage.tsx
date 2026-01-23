import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import { useUpdateWorkflow } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { WorkflowStatusBadge } from "./StatusBadge";
import { Button } from "../ui";
import { Archive, RotateCcw, Trash2, ArrowLeft } from "lucide-react";
import { getWorkflowTitle } from "../lib/workflowUtils";

export default function ArchivedPage() {
  const navigate = useNavigate();
  const { data: workflows = [], isLoading } = useWorkflows();
  const updateWorkflowMutation = useUpdateWorkflow();

  // Filter to only archived workflows
  const archivedWorkflows = workflows.filter(w => w.status === "archived");

  const handleRestore = async (workflowId: string) => {
    try {
      // Restore to draft status
      await updateWorkflowMutation.mutateAsync({
        workflowId,
        status: "draft"
      });
    } catch (error) {
      console.error("Failed to restore workflow:", error);
    }
  };

  const formatDate = (timestamp: string) => {
    if (!timestamp) return "Unknown date";
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Archived Workflows" />

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to automations
        </Link>

        <h1 className="text-xl font-semibold text-gray-900 mb-6">
          <Archive className="inline w-5 h-5 mr-2 text-gray-400" />
          Archived Workflows ({archivedWorkflows.length})
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : archivedWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Archive className="w-12 h-12 text-gray-300 mb-4" />
            <div className="text-gray-500 mb-2">No archived workflows</div>
            <div className="text-gray-400 text-sm">
              Archived drafts will appear here
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {archivedWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-white rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-700 truncate">
                        {getWorkflowTitle(workflow)}
                      </h3>
                      <WorkflowStatusBadge status={workflow.status} />
                    </div>
                    <div className="text-sm text-gray-400">
                      Created: {formatDate(workflow.timestamp)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(workflow.id)}
                      disabled={updateWorkflowMutation.isPending}
                      className="flex items-center gap-1"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Restore
                    </Button>
                    <Link to={`/workflows/${workflow.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500"
                      >
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
