import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { 
  useWorkflow, 
  useLatestScriptByWorkflowId, 
  useScriptRunsByWorkflowId 
} from "../hooks/dbScriptReads";
import { useTask } from "../hooks/dbTaskReads";
import { useUpdateWorkflow } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";

const getStatusBadge = (workflow: any) => {
  if (workflow.status === "disabled") {
    return <Badge variant="secondary">Disabled</Badge>;
  } else if (workflow.status === "active") {
    return <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>;
  } else {
    return <Badge variant="outline">Pending</Badge>;
  }
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: workflow, isLoading } = useWorkflow(id!);
  const { data: task } = useTask(workflow?.task_id || "");
  const { data: latestScript } = useLatestScriptByWorkflowId(id!);
  const { data: scriptRuns = [], isLoading: isLoadingRuns } = useScriptRunsByWorkflowId(id!);
  const [successMessage, setSuccessMessage] = useState<string>("");
  
  const updateWorkflowMutation = useUpdateWorkflow();

  const handleDisable = async () => {
    if (!workflow) return;
    
    const newStatus = workflow.status === "disabled" ? "" : "disabled";
    
    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: newStatus,
    }, {
      onSuccess: () => {
        setSuccessMessage(newStatus === "disabled" ? "Workflow disabled" : "Workflow enabled");
        setTimeout(() => setSuccessMessage(""), 3000);
      },
    });
  };

  const handleRunNow = () => {
    // TODO: Implement run now functionality
    setSuccessMessage("Run now feature coming soon");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const handleChat = () => {
    if (task?.chat_id) {
      navigate(`/chats/${task.chat_id}`);
    }
  };

  if (!id) {
    return <div>Workflow ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Workflows"
        subtitle={workflow ? (workflow.title || `Workflow ${workflow.id.slice(0, 8)}`) : undefined}
      />

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading workflow...</div>
          </div>
        ) : !workflow ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Workflow not found</div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {/* Workflow Metadata */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
                  </h2>
                  {getStatusBadge(workflow)}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    <Button
                      onClick={handleRunNow}
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                    >
                      Run now
                    </Button>
                    <Button
                      onClick={handleDisable}
                      disabled={updateWorkflowMutation.isPending}
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                    >
                      {workflow.status === "disabled" ? "Enable" : "Disable"}
                    </Button>
                    {task?.chat_id && (
                      <Button
                        onClick={handleChat}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        Chat
                      </Button>
                    )}
                  </div>
                  {successMessage && (
                    <div className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                      {successMessage}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Created</h3>
                    <p className="text-gray-900">
                      {new Date(workflow.timestamp).toLocaleString()}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Workflow ID</h3>
                    <p className="text-gray-900 font-mono text-sm">{workflow.id}</p>
                  </div>

                  {workflow.cron && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Schedule</h3>
                      <p className="text-gray-900">{workflow.cron}</p>
                    </div>
                  )}

                  {workflow.events && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">Events</h3>
                      <p className="text-gray-900">{workflow.events}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Latest Script Section */}
            {latestScript && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Latest Script</h2>
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

            {/* Task Section */}
            {task && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Task</h2>
                <Link
                  to={`/tasks/${task.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">
                          {task.title || `Task ${task.id.slice(0, 8)}`}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Task ID: {task.id}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Script Runs List */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Script Runs</h2>
              {isLoadingRuns ? (
                <div className="flex items-center justify-center py-4">
                  <div>Loading script runs...</div>
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
                      to={`/scripts/${run.script_id}/runs/${run.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">Run {run.id.slice(0, 8)}</span>
                            <Badge variant={run.error ? 'destructive' : run.end_timestamp ? 'default' : 'secondary'}>
                              {run.error ? 'error' : run.end_timestamp ? 'completed' : 'running'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Started: {new Date(run.start_timestamp).toLocaleString()}</span>
                            {run.end_timestamp && (
                              <span>Ended: {new Date(run.end_timestamp).toLocaleString()}</span>
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
