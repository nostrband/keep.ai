import React, { useState, useMemo, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Task, Script } from "@app/db";
import { formatVersion } from "@app/db";
import {
  useWorkflow,
  useLatestScriptByWorkflowId,
  useScriptRunsByWorkflowId,
  useScriptVersionsByWorkflowId
} from "../hooks/dbScriptReads";
import { useChat } from "../hooks/dbChatReads";
import { useMaintainerTasks } from "../hooks/dbTaskReads";
import { useUpdateWorkflow, useActivateScriptVersion } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import ScriptDiff from "./ScriptDiff";
import { Badge, Button } from "../ui";
import { Archive, RotateCcw } from "lucide-react";
import { workflowNotifications } from "../lib/WorkflowNotifications";
import { WorkflowStatusBadge, ScriptRunStatusBadge, TaskStatusBadge } from "./StatusBadge";
import { formatCronSchedule } from "../lib/formatCronSchedule";
import { useAutoHidingMessage } from "../hooks/useAutoHidingMessage";
import { WorkflowErrorAlert } from "./WorkflowErrorAlert";
import { useUnresolvedWorkflowError } from "../hooks/useNotifications";
import { getWorkflowTitle } from "../lib/workflowUtils";
import { WorkflowInputsSummary } from "./WorkflowInputsSummary";
import { WorkflowIntentSection } from "./WorkflowIntentSection";
import { usePendingReconciliation } from "../hooks/dbInputReads";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workflow, isLoading } = useWorkflow(id!);
  // Use workflow.chat_id directly (Spec 09) instead of going through task
  const { data: chat } = useChat(workflow?.chat_id || "");
  const { data: latestScript } = useLatestScriptByWorkflowId(id!);
  const { data: scriptRuns = [], isLoading: isLoadingRuns } = useScriptRunsByWorkflowId(id!);
  const { data: scriptVersions = [], isLoading: isLoadingVersions } = useScriptVersionsByWorkflowId(id!);
  const { data: unresolvedError } = useUnresolvedWorkflowError(id!);
  const { data: pendingReconciliation = [] } = usePendingReconciliation(id!);
  const { data: maintainerTasks = [] } = useMaintainerTasks(id!);
  const success = useAutoHidingMessage({ duration: 3000 });
  const warning = useAutoHidingMessage({ duration: 5000 });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ oldId: string; newId: string } | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

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

  // Build a lookup from maintainer task_id to the script it produced
  const scriptByTaskId = useMemo(() => {
    const map = new Map<string, Script>();
    for (const s of scriptVersions) {
      if (s.task_id && s.minor_version > 0) {
        // Fix scripts have minor_version > 0; keep the latest one per task
        const existing = map.get(s.task_id);
        if (!existing || s.minor_version > existing.minor_version) {
          map.set(s.task_id, s as Script);
        }
      }
    }
    return map;
  }, [scriptVersions]);

  // Clear workflow notifications when viewing this workflow
  // This prevents re-notifying user for errors they've already seen
  useEffect(() => {
    if (id) {
      workflowNotifications.clearWorkflowNotifications(id);
    }
  }, [id]);

  // Helper to show warning (clears success message first)
  const showWarning = (message: string) => {
    success.clear();
    warning.show(message);
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
        success.show("Automation activated!");
      },
    });
  };

  const handlePause = async () => {
    if (!workflow) return;

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: "paused",  // Changed from 'disabled' (Spec 11)
    }, {
      onSuccess: () => {
        success.show("Automation paused");
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
        success.show("Automation resumed");
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
        success.show("Workflow scheduled to run now");
      },
    });
  };

  const handleChat = () => {
    // Use workflow.chat_id directly (Spec 09)
    if (workflow?.chat_id) {
      navigate(`/chats/${workflow.chat_id}`);
    }
  };

  const handleArchive = () => {
    if (!workflow) return;
    setShowArchiveConfirm(true);
  };

  const confirmArchive = () => {
    if (!workflow) return;
    setShowArchiveConfirm(false);

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: "archived",
    }, {
      onSuccess: () => {
        success.show("Workflow archived");
        navigate("/archived");
      },
    });
  };

  const handleRestore = async () => {
    if (!workflow) return;

    // Smart restore: "paused" if has scripts, "draft" if not (spec: smart-workflow-restore-status)
    const restoreStatus = workflow.active_script_id ? "paused" : "draft";

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      status: restoreStatus,
    }, {
      onSuccess: () => {
        success.show(`Workflow restored to ${restoreStatus}`);
      },
    });
  };

  const handleActivateVersion = (scriptId: string, majorVersion: number, minorVersion: number) => {
    if (!workflow) return;

    activateMutation.mutate({
      workflowId: workflow.id,
      scriptId: scriptId,
    }, {
      onSuccess: () => {
        success.show(`Activated v${majorVersion}.${minorVersion}`);
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
        subtitle={workflow ? (getWorkflowTitle(workflow)) : undefined}
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
            {/* Error Alert - show unresolved errors at the top */}
            {unresolvedError && (
              <WorkflowErrorAlert notification={unresolvedError} />
            )}

            {/* Reconciliation Alert - show when mutations have uncertain outcomes */}
            {pendingReconciliation.length > 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <div className="flex-1">
                    <div className="font-medium text-amber-800">
                      {pendingReconciliation.length === 1
                        ? "Verifying action completed successfully"
                        : `Verifying ${pendingReconciliation.length} actions completed successfully`}
                    </div>
                    <p className="text-sm text-amber-700 mt-1">
                      {pendingReconciliation[0].ui_title
                        ? `"${pendingReconciliation[0].ui_title}" — outcome is uncertain and needs verification.`
                        : "An action's outcome is uncertain and needs verification."}
                    </p>
                    <Link
                      to={`/workflow/${id}/outputs?filter=indeterminate`}
                      className="text-sm text-amber-800 underline mt-2 inline-block hover:text-amber-900"
                    >
                      View details
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Archived workflow restore banner */}
            {workflow.status === "archived" && (
              <div className="mb-6 flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-600">
                  <Archive className="w-5 h-5" />
                  <span>This workflow is archived and hidden from the main list.</span>
                </div>
                <Button
                  onClick={handleRestore}
                  disabled={updateWorkflowMutation.isPending}
                  size="sm"
                  className="flex items-center gap-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restore
                </Button>
              </div>
            )}

            {/* Workflow Metadata */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {getWorkflowTitle(workflow)}
                  </h2>
                  <WorkflowStatusBadge status={workflow.status} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    {/* Primary action button: Activate, Pause, or Resume - always first */}
                    {workflow.status === "ready" && (
                      <Button
                        onClick={handleActivate}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
                      >
                        Activate
                      </Button>
                    )}
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
                    {(workflow.status === "paused" || workflow.status === "error") && (
                      <Button
                        onClick={handleResume}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
                      >
                        Resume
                      </Button>
                    )}

                    {/* Secondary actions: Run now, Test run, Edit */}
                    {(workflow.status === "draft" || workflow.status === "ready" || workflow.status === "active") && activeScript && (
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
                    {workflow?.chat_id && (
                      <Button
                        onClick={handleChat}
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        Edit
                      </Button>
                    )}
                    {/* Archive button for drafts and paused workflows (spec: expand-archive-to-paused-workflows) */}
                    {(workflow.status === "draft" || workflow.status === "paused") && (
                      <Button
                        onClick={handleArchive}
                        disabled={updateWorkflowMutation.isPending}
                        size="sm"
                        variant="ghost"
                        className="cursor-pointer text-gray-400 hover:text-gray-600"
                        title="Archive this workflow"
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  {/* Show hint if no script exists yet */}
                  {workflow.status === "draft" && !activeScript && (
                    <div className="text-sm text-gray-500">
                      Script required to activate
                    </div>
                  )}
                  {success.message && (
                    <div className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                      {success.message}
                    </div>
                  )}
                  {warning.message && (
                    <div className="text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                      {warning.message}
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
                      <p className="text-gray-900">{formatCronSchedule(workflow.cron)}</p>
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

            {/* Inputs & Outputs Summary */}
            <WorkflowInputsSummary workflowId={workflow.id} />

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

            {/* Intent Section - shows goal, inputs, outputs, constraints */}
            <WorkflowIntentSection intentSpecJson={workflow.intent_spec} />

            {/* Auto-Fix History Section - shows maintainer tasks for this workflow */}
            {maintainerTasks.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Auto-Fix History</h2>
                <div className="space-y-3">
                  {maintainerTasks.map((task: Task) => {
                    const fixScript = scriptByTaskId.get(task.id);
                    return (
                      <Link
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900">{task.title || `Auto-fix ${task.id.slice(0, 8)}`}</span>
                              <TaskStatusBadge state={task.state} defaultLabel="Pending" />
                              {fixScript && (
                                <span className="text-xs text-gray-500 font-mono">
                                  v{formatVersion(fixScript.major_version, fixScript.minor_version)}
                                </span>
                              )}
                            </div>
                            {fixScript?.change_comment && (
                              <p className="text-sm text-gray-600 mb-1 line-clamp-2">
                                {fixScript.change_comment}
                              </p>
                            )}
                            {task.error && (
                              <p className="text-sm text-red-600 mb-1 line-clamp-2">
                                {task.error}
                              </p>
                            )}
                            <div className="text-xs text-gray-500">
                              {new Date(task.timestamp * 1000).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
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
                        <Badge variant="outline">v{activeScript.major_version}.{activeScript.minor_version}</Badge>
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
                        {scriptVersions.map((version: any, index: number) => {
                          const isActive = version.id === activeScript.id;
                          // Find previous version: same major with lower minor, or previous major
                          const previousVersion = scriptVersions[index + 1]; // Already sorted DESC
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
                                        v{version.major_version}.{version.minor_version}
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
                                        onClick={() => handleActivateVersion(version.id, version.major_version, version.minor_version)}
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
                                    oldVersion={`${diffScripts.old.major_version}.${diffScripts.old.minor_version}`}
                                    newVersion={`${diffScripts.new.major_version}.${diffScripts.new.minor_version}`}
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

      {/* Archive Confirmation Modal */}
      {showArchiveConfirm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowArchiveConfirm(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <Archive className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Archive Workflow?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              This workflow will be moved to the archive. You can restore it later from the{" "}
              <span className="font-medium">Archived</span> page.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowArchiveConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmArchive}
                disabled={updateWorkflowMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {updateWorkflowMutation.isPending ? "Archiving..." : "Archive"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
