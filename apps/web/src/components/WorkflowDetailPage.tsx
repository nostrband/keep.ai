import React, { useState, useMemo, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useWorkflow,
  useLatestScriptByWorkflowId,
  useScriptRunsByWorkflowId,
  useScriptVersionsByWorkflowId
} from "../hooks/dbScriptReads";
import { useTask } from "../hooks/dbTaskReads";
import { useChat } from "../hooks/dbChatReads";
import { useUpdateWorkflow, useActivateScriptVersion } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { Response } from "../ui";
import ScriptDiff from "./ScriptDiff";
import { Badge, Button } from "../ui";
import { workflowNotifications } from "../lib/WorkflowNotifications";
import { WorkflowStatusBadge, ScriptRunStatusBadge } from "./StatusBadge";
import { API_ENDPOINT } from "../const";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workflow, isLoading } = useWorkflow(id!);
  const { data: task } = useTask(workflow?.task_id || "");
  const { data: chat } = useChat(task?.chat_id || "");
  const { data: latestScript } = useLatestScriptByWorkflowId(id!);
  const { data: scriptRuns = [], isLoading: isLoadingRuns } = useScriptRunsByWorkflowId(id!);
  const { data: scriptVersions = [], isLoading: isLoadingVersions } = useScriptVersionsByWorkflowId(id!);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [warningMessage, setWarningMessage] = useState<string>("");
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ oldId: string; newId: string } | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWorkflowMutation = useUpdateWorkflow();
  const activateMutation = useActivateScriptVersion();

  // Get the active script (pointed to by workflow.active_script_id)
  // Falls back to latestScript for backwards compatibility during migration
  const activeScript = useMemo(() => {
    if (!workflow?.active_script_id || scriptVersions.length === 0) {
      return latestScript; // Fallback for workflows without active_script_id set
    }
    return scriptVersions.find((s: any) => s.id === workflow.active_script_id) || latestScript;
  }, [workflow?.active_script_id, scriptVersions, latestScript]);

  // Memoize mermaid markdown to maintain referential stability for Response memo
  const diagramMarkdown = useMemo(
    () => activeScript?.diagram ? `\`\`\`mermaid\n${activeScript.diagram}\n\`\`\`` : null,
    [activeScript?.diagram]
  );

  // Clear workflow notifications when viewing this workflow
  // This prevents re-notifying user for errors they've already seen
  useEffect(() => {
    if (id) {
      workflowNotifications.clearWorkflowNotifications(id);
    }
  }, [id]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, []);

  // Helper to show success message with auto-clear
  const showSuccessMessage = (message: string) => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    setSuccessMessage(message);
    successTimeoutRef.current = setTimeout(() => {
      setSuccessMessage("");
      successTimeoutRef.current = null;
    }, 3000);
  };

  // Helper to show warning message with auto-clear
  const showWarning = (message: string) => {
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }
    setSuccessMessage(""); // Clear success message when showing warning
    setWarningMessage(message);
    warningTimeoutRef.current = setTimeout(() => {
      setWarningMessage("");
      warningTimeoutRef.current = null;
    }, 5000);
  };

  // Get next run time from workflow.next_run_timestamp
  // Only show for active workflows - scheduler only executes where status === 'active'
  const nextRunTime = useMemo(() => {
    if (!workflow?.next_run_timestamp || workflow.status !== 'active') {
      return null;
    }

    try {
      return new Date(workflow.next_run_timestamp);
    } catch (error) {
      console.error('Invalid next_run_timestamp:', error);
      return null;
    }
  }, [workflow?.next_run_timestamp, workflow?.status]);

  const handleActivate = async () => {
    if (!workflow || !activeScript) return;

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: "active",
    }, {
      onSuccess: () => {
        showSuccessMessage("Automation activated!");
      },
    });
  };

  const handlePause = async () => {
    if (!workflow) return;

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: "disabled",
    }, {
      onSuccess: () => {
        showSuccessMessage("Automation paused");
      },
    });
  };

  const handleResume = async () => {
    if (!workflow) return;

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: "active",
    }, {
      onSuccess: () => {
        showSuccessMessage("Automation resumed");
      },
    });
  };

  const handleRunNow = () => {
    if (!workflow) return;

    // Set next_run_timestamp to current time to trigger immediate execution
    const now = new Date().toISOString();

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      next_run_timestamp: now,
    }, {
      onSuccess: () => {
        showSuccessMessage("Workflow scheduled to run now");
      },
    });
  };

  const handleTestRun = async () => {
    if (!workflow || !activeScript) return;

    setIsTestRunning(true);
    setWarningMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`${API_ENDPOINT}/workflow/test-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflow_id: workflow.id }),
      });

      const result = await response.json();

      if (result.success) {
        showSuccessMessage("Test completed successfully");
      } else {
        showWarning(`Test failed: ${result.error || 'Unknown error'}`);
      }

      // Refresh the script runs list to show the new test run
      queryClient.invalidateQueries({ queryKey: ['scriptRuns', workflow.id] });
    } catch (error) {
      showWarning(`Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsTestRunning(false);
    }
  };

  const handleChat = () => {
    if (task?.chat_id) {
      navigate(`/chats/${task.chat_id}`);
    }
  };

  const handleActivateVersion = (scriptId: string, version: number) => {
    if (!workflow) return;

    activateMutation.mutate({
      workflowId: workflow.id,
      scriptId: scriptId,
    }, {
      onSuccess: () => {
        showSuccessMessage(`Activated v${version}`);
        setShowVersionHistory(false);
        setDiffVersions(null);
      },
    });
  };

  const handleShowDiff = (oldScriptId: string, newScriptId: string) => {
    if (diffVersions?.oldId === oldScriptId && diffVersions?.newId === newScriptId) {
      setDiffVersions(null);  // Toggle off
    } else {
      setDiffVersions({ oldId: oldScriptId, newId: newScriptId });
    }
  };

  // Get scripts for diff view
  const diffScripts = useMemo(() => {
    if (!diffVersions) return null;
    const oldScript = scriptVersions.find((s: any) => s.id === diffVersions.oldId);
    const newScript = scriptVersions.find((s: any) => s.id === diffVersions.newId);
    return oldScript && newScript ? { old: oldScript, new: newScript } : null;
  }, [diffVersions, scriptVersions]);

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
                  <WorkflowStatusBadge status={workflow.status} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    {/* Show Activate button for Draft workflows with a script */}
                    {workflow.status === "" && activeScript && (
                      <Button
                        onClick={handleActivate}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
                      >
                        Activate
                      </Button>
                    )}
                    {/* Show Run now button for Draft workflows without cron, or for testing */}
                    {(workflow.status === "" || workflow.status === "active") && activeScript && (
                      <Button
                        onClick={handleRunNow}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        Run now
                      </Button>
                    )}
                    {/* Show Test Run button for any workflow with a script - runs immediately without affecting workflow state */}
                    {activeScript && (
                      <Button
                        onClick={handleTestRun}
                        disabled={isTestRunning || updateWorkflowMutation.isPending}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
                      >
                        {isTestRunning ? "Testing..." : "Test run"}
                      </Button>
                    )}
                    {/* Show Pause button for Active workflows */}
                    {workflow.status === "active" && (
                      <Button
                        onClick={handlePause}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        Pause
                      </Button>
                    )}
                    {/* Show Resume button for Paused workflows */}
                    {workflow.status === "disabled" && (
                      <Button
                        onClick={handleResume}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        Resume
                      </Button>
                    )}
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
                  {/* Show hint if no script exists yet */}
                  {workflow.status === "" && !activeScript && (
                    <div className="text-sm text-gray-500">
                      Script required to activate
                    </div>
                  )}
                  {successMessage && (
                    <div className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                      {successMessage}
                    </div>
                  )}
                  {warningMessage && (
                    <div className="text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                      {warningMessage}
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
                      {nextRunTime && (
                        <p className="text-sm text-gray-600 mt-1">
                          Next run at: {nextRunTime.toLocaleString()}
                        </p>
                      )}
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

            {/* Chat Section */}
            {chat && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Chat</h2>
                <Link
                  to={`/chats/${chat.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">Chat {chat.id.slice(0, 8)}</span>
                      </div>
                      {chat.first_message && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {chat.first_message}
                        </p>
                      )}
                      <div className="text-xs text-gray-500">
                        Last updated: {new Date(chat.updated_at).toLocaleString()}
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

            {/* Script Section */}
            {activeScript && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Script</h2>
                  {scriptVersions.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowVersionHistory(!showVersionHistory)}
                      className="cursor-pointer"
                    >
                      {showVersionHistory ? "Hide history" : `View history (${scriptVersions.length} versions)`}
                    </Button>
                  )}
                </div>

                {/* Active Script */}
                <Link
                  to={`/scripts/${activeScript.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">Script {activeScript.id.slice(0, 8)}</span>
                        <Badge variant="outline">v{activeScript.version}</Badge>
                        <Badge className="bg-blue-100 text-blue-800">Active</Badge>
                      </div>
                      {activeScript.change_comment && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {activeScript.change_comment}
                        </p>
                      )}
                      <div className="text-xs text-gray-500">
                        Updated: {new Date(activeScript.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Version History */}
                {showVersionHistory && (
                  <div className="mt-4 border-t border-gray-200 pt-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Version History</h3>
                    {isLoadingVersions ? (
                      <div className="text-sm text-gray-500">Loading versions...</div>
                    ) : (
                      <div className="space-y-2">
                        {scriptVersions.map((version: any) => {
                          const isActive = version.id === activeScript.id;
                          // Find previous version by version number, not array index (more robust)
                          const previousVersion = scriptVersions.find((v: any) => v.version === version.version - 1);
                          const canShowDiff = previousVersion !== undefined;
                          const isShowingDiff = diffVersions?.oldId === previousVersion?.id && diffVersions?.newId === version.id;

                          return (
                            <div key={version.id}>
                              <div
                                className={`p-3 border rounded-lg ${
                                  isActive
                                    ? "border-blue-300 bg-blue-50"
                                    : "border-gray-200 hover:border-gray-300"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <Link
                                        to={`/scripts/${version.id}`}
                                        className="font-medium text-gray-900 hover:text-blue-600"
                                      >
                                        v{version.version}
                                      </Link>
                                      {isActive && (
                                        <Badge className="bg-blue-100 text-blue-800 text-xs">Active</Badge>
                                      )}
                                    </div>
                                    {version.change_comment && (
                                      <p className="text-sm text-gray-600 mt-1 line-clamp-1">
                                        {version.change_comment}
                                      </p>
                                    )}
                                    <div className="text-xs text-gray-500 mt-1">
                                      {new Date(version.timestamp).toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 ml-4">
                                    {canShowDiff && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleShowDiff(previousVersion.id, version.id)}
                                        className="cursor-pointer text-xs"
                                      >
                                        {isShowingDiff ? "Hide diff" : "Show diff"}
                                      </Button>
                                    )}
                                    {!isActive && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleActivateVersion(version.id, version.version)}
                                        disabled={activateMutation.isPending}
                                        className="cursor-pointer text-xs"
                                      >
                                        {activateMutation.isPending ? "Activating..." : "Activate"}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Diff View */}
                              {isShowingDiff && diffScripts && (
                                <div className="mt-2 ml-4">
                                  <ScriptDiff
                                    oldCode={diffScripts.old.code}
                                    newCode={diffScripts.new.code}
                                    oldVersion={diffScripts.old.version}
                                    newVersion={diffScripts.new.version}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* What This Automation Does - Summary and Diagram */}
            {activeScript && (activeScript.summary || activeScript.diagram) && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">What This Automation Does</h2>

                {/* Summary */}
                {activeScript.summary && (
                  <p className="text-gray-700 mb-4">{activeScript.summary}</p>
                )}

                {/* Mermaid Diagram - rendered via markdown code fence */}
                {diagramMarkdown && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <Response>{diagramMarkdown}</Response>
                  </div>
                )}
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
                            <ScriptRunStatusBadge
                              error={run.error}
                              endTimestamp={run.end_timestamp}
                              labels={{ error: "error", success: "completed", running: "running" }}
                            />
                            {/* Show test badge if this is a test run */}
                            {run.type === 'test' && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
                                Test
                              </Badge>
                            )}
                            {/* Show retry badge if this is a retry run */}
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
                            {/* Show cost if any (stored in microdollars, display as dollars) */}
                            {run.cost > 0 && (
                              <span className="flex items-center gap-1">
                                <span>💵</span>
                                <span>{(run.cost / 1000000).toFixed(2)}</span>
                              </span>
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
