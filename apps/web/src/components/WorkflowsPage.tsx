import React, { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import SharedHeader from "./SharedHeader";
import { Button } from "../ui";
import { WorkflowStatusBadge } from "./StatusBadge";
import { getWorkflowTitle } from "../lib/workflowUtils";

export default function WorkflowsPage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get("filter");

  // Filter workflows based on query parameter
  const filteredWorkflows = useMemo(() => {
    if (filterParam === "drafts") {
      return workflows.filter((w) => w.status === "draft");
    }
    return workflows;
  }, [workflows, filterParam]);

  // Determine page title based on filter
  const pageTitle = filterParam === "drafts" ? "Drafts" : "Workflows";
  const emptyMessage =
    filterParam === "drafts" ? "No draft workflows found" : "No workflows found";

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
          {filterParam === "drafts" && (
            <Link
              to="/workflows"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              View all workflows
            </Link>
          )}
        </div>

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
                      {workflow.cron && <span>Schedule: {workflow.cron}</span>}
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
