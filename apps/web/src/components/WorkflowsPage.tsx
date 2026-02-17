import React, { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import { useResumableWorkflows, useResumeWorkflows } from "../hooks/useNotifications";
import SharedHeader from "./SharedHeader";
import { Button } from "../ui";
import { WorkflowStatusBadge } from "./StatusBadge";
import { getWorkflowTitle } from "../lib/workflowUtils";
import { formatCronSchedule } from "../lib/formatCronSchedule";

// Supported filter values (case-insensitive matching)
const VALID_FILTERS = ["drafts"] as const;
type ValidFilter = typeof VALID_FILTERS[number];

function normalizeFilter(param: string | null): ValidFilter | null {
  if (!param) return null;
  const normalized = param.toLowerCase();
  return VALID_FILTERS.includes(normalized as ValidFilter) ? (normalized as ValidFilter) : null;
}

export default function WorkflowsPage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const { data: resumable = [] } = useResumableWorkflows();
  const resumeMutation = useResumeWorkflows();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFilter = searchParams.get("filter");
  const filter = normalizeFilter(rawFilter);

  // Filter workflows based on query parameter
  const filteredWorkflows = useMemo(() => {
    if (filter === "drafts") {
      return workflows.filter((w) => w.status === "draft");
    }
    return workflows;
  }, [workflows, filter]);

  // Determine page title based on filter
  const pageTitle = filter === "drafts" ? "Drafts" : "Workflows";
  const emptyMessage =
    filter === "drafts" ? "No draft workflows found" : "No workflows found";

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title={pageTitle} />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Create Workflow Button */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            onClick={() => navigate("/")}
            size="sm"
            variant="outline"
            className="cursor-pointer"
          >
            Create Workflow
          </Button>
          {filter === "drafts" && (
            <Link
              to="/workflows"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              View all workflows
            </Link>
          )}
        </div>

        {resumable.length > 0 && (
          <div className="mb-4 flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-4">
            <span className="text-sm text-green-800">
              {resumable.length} workflow{resumable.length === 1 ? "" : "s"} can be resumed — connection restored
            </span>
            <Button
              size="sm"
              onClick={() => resumeMutation.mutate(resumable)}
              disabled={resumeMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white cursor-pointer"
            >
              {resumeMutation.isPending ? "Resuming..." : "Resume All"}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading workflows...</div>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">{emptyMessage}</div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredWorkflows.map((workflow) => (
              <Link
                key={workflow.id}
                to={`/workflows/${workflow.id}`}
                className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-gray-900">
                        {getWorkflowTitle(workflow)}
                      </h3>
                      <WorkflowStatusBadge status={workflow.status} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      {workflow.cron && <span>Schedule: {formatCronSchedule(workflow.cron)}</span>}
                      {workflow.events && <span>Events: {workflow.events}</span>}
                      <span>
                        Created: {new Date(workflow.timestamp).toLocaleString()}
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
