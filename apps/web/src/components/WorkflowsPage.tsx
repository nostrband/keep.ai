import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";

const getStatusBadge = (workflow: any) => {
  if (workflow.status === "disabled") {
    return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
  } else if (workflow.status === "active") {
    return <Badge className="bg-green-100 text-green-800">Running</Badge>;
  } else {
    return <Badge variant="outline">Draft</Badge>;
  }
};

export default function WorkflowsPage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Workflows" />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Create Workflow Button */}
        <div className="mb-6">
          <Button
            onClick={() => navigate("/new")}
            size="sm"
            variant="outline"
            className="cursor-pointer"
          >
            Create Workflow
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading workflows...</div>
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">No workflows found</div>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <Link
                key={workflow.id}
                to={`/workflows/${workflow.id}`}
                className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-gray-900">
                        {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
                      </h3>
                      {getStatusBadge(workflow)}
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
