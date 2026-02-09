import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import { useTasks } from "../hooks/dbTaskReads";
import { useFileUpload } from "../hooks/useFileUpload";
import { useDbQuery } from "../hooks/dbQuery";
import { useCreateTask } from "../hooks/dbWrites";
// import { useAutonomyPreference } from "../hooks/useAutonomyPreference";
import SharedHeader from "./SharedHeader";
import { WorkflowStatusBadge } from "./StatusBadge";
import { formatCronSchedule } from "../lib/formatCronSchedule";
import { getWorkflowTitle, isScriptRunRunning } from "../lib/workflowUtils";
import { StaleDraftsBanner } from "./StaleDraftsBanner";
import {
  Badge,
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  Suggestions,
  Suggestion,
  // TODO: re-enable autonomy mode toggle for v2
  // Tooltip,
  // TooltipContent,
  // TooltipProvider,
  // TooltipTrigger,
} from "../ui";
import { PlusIcon, AlertCircle, /* Info, */ Sparkles } from "lucide-react";
import type { FileUIPart } from "ai";
import type { File as DbFile, ScriptRun, Workflow, Task } from "@app/db";

type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

// Error types that require user attention (non-fixable)
// Logic errors are handled silently by the agent via maintenance mode
const ATTENTION_ERROR_TYPES = ['auth', 'permission', 'network', 'internal'];

// Example automation suggestions for first-time users
const EXAMPLE_SUGGESTIONS = [
  "Send me a daily summary of my unread emails",
  "Alert me when a website changes",
  "Remind me to drink water every 2 hours",
  "Save interesting tweets to a note",
];

type AttentionLevel = "none" | "warning" | "error";

// Compute secondary line text for workflow
function getSecondaryLine(workflow: Workflow, latestRun: ScriptRun | undefined, task: Task | undefined, reconciliationCount: number): { text: string; isAttention: boolean; attentionLevel: AttentionLevel } {
  // Check if task is waiting for input
  if (task && (task.state === "wait" || task.state === "asks")) {
    return { text: "Waiting for your input", isAttention: true, attentionLevel: "error" };
  }

  // Check if workflow is in maintenance mode (agent is auto-fixing)
  // Per spec 09b: Logic errors are handled silently, don't show as needing attention
  if (workflow.maintenance) {
    return { text: "Auto-fixing issue...", isAttention: false, attentionLevel: "none" };
  }

  // Check latest run status
  if (latestRun) {
    if (latestRun.error) {
      const runTime = new Date(latestRun.end_timestamp || latestRun.start_timestamp);
      const ago = formatTimeAgo(runTime);
      const errorType = latestRun.error_type || '';

      // Only mark as needing attention for non-logic errors
      // Logic errors are handled by the agent via maintenance mode
      const needsAttention = ATTENTION_ERROR_TYPES.includes(errorType) ||
        (errorType === '' && !workflow.maintenance); // Legacy errors or unclassified

      if (needsAttention) {
        // Show user-friendly message based on error type
        if (errorType === 'auth') {
          return { text: `⚠ Authentication expired ${ago}`, isAttention: true, attentionLevel: "error" };
        } else if (errorType === 'permission') {
          return { text: `⚠ Permission denied ${ago}`, isAttention: true, attentionLevel: "error" };
        } else if (errorType === 'network') {
          return { text: `⚠ Network error ${ago}`, isAttention: true, attentionLevel: "error" };
        } else if (errorType === 'internal') {
          return { text: `⚠ Something went wrong ${ago} - contact support`, isAttention: true, attentionLevel: "error" };
        }
        return { text: `⚠ Failed ${ago} - needs attention`, isAttention: true, attentionLevel: "error" };
      } else {
        // Logic error - agent is handling it
        return { text: `Issue detected ${ago} - fixing...`, isAttention: false, attentionLevel: "none" };
      }
    }

    if (latestRun.end_timestamp) {
      const runTime = new Date(latestRun.end_timestamp);
      const ago = formatTimeAgo(runTime);
      return { text: `Last run: ${ago} ✓`, isAttention: false, attentionLevel: "none" };
    }

    // Still running — check if paused for reconciliation
    if (reconciliationCount > 0) {
      return { text: "Verifying action completed...", isAttention: true, attentionLevel: "warning" };
    }
    return { text: "Running now...", isAttention: false, attentionLevel: "none" };
  }

  // No latest run but has reconciliation mutations
  if (reconciliationCount > 0) {
    return { text: "Verifying action completed...", isAttention: true, attentionLevel: "warning" };
  }

  // Check next run time
  if (workflow.next_run_timestamp && workflow.status === "active") {
    const nextRun = new Date(workflow.next_run_timestamp);
    if (nextRun > new Date()) {
      return { text: `Next run: ${formatNextRun(nextRun)}`, isAttention: false, attentionLevel: "none" };
    }
  }

  // Check if scheduled
  if (!workflow.cron && !workflow.events) {
    return { text: "Not scheduled", isAttention: false, attentionLevel: "none" };
  }

  return { text: workflow.cron || workflow.events || "No schedule", isAttention: false, attentionLevel: "none" };
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatNextRun(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;

  // Show day and time
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MainPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { api } = useDbQuery();
  const { data: workflows = [], isLoading: isLoadingWorkflows } = useWorkflows();
  const { data: tasks = [] } = useTasks(false); // Get non-finished tasks
  // TODO: re-enable autonomy mode toggle for v2
  // const { mode: autonomyMode, toggleMode: toggleAutonomyMode, isLoaded: isAutonomyLoaded } = useAutonomyPreference();
  const [input, setInput] = useState("");
  const [latestRuns, setLatestRuns] = useState<Record<string, ScriptRun>>({});
  const [reconciliationCounts, setReconciliationCounts] = useState<Record<string, number>>({});
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { uploadFiles, uploadState } = useFileUpload();
  const createTask = useCreateTask();

  // Fetch latest run for each workflow using batch query
  useEffect(() => {
    if (!api || workflows.length === 0) return;

    let cancelled = false;

    const fetchRuns = async () => {
      try {
        const workflowIds = workflows.map(w => w.id);
        const [runsMap, indeterminate, needsReconcile] = await Promise.all([
          api.scriptStore.getLatestRunsByWorkflowIds(workflowIds),
          api.mutationStore.getIndeterminate(),
          api.mutationStore.getNeedsReconcile(),
        ]);

        // Check if component unmounted during fetch
        if (cancelled) return;

        // Convert Map to Record for state
        const runs: Record<string, ScriptRun> = {};
        for (const [workflowId, run] of runsMap) {
          runs[workflowId] = run;
        }
        setLatestRuns(runs);

        // Group reconciliation mutations by workflow_id
        const counts: Record<string, number> = {};
        for (const m of [...indeterminate, ...needsReconcile]) {
          counts[m.workflow_id] = (counts[m.workflow_id] || 0) + 1;
        }
        setReconciliationCounts(counts);
      } catch {
        // Ignore errors
      }
    };

    fetchRuns();

    // Cleanup: prevent state update if component unmounts during fetch
    return () => {
      cancelled = true;
    };
  }, [api, workflows]);

  // Create a map of task_id to task for quick lookup
  const taskMap = useMemo(() => {
    const map: Record<string, Task> = {};
    for (const task of tasks) {
      map[task.id] = task;
    }
    return map;
  }, [tasks]);

  // Compute attention count, sort workflows, and count archived
  const { sortedWorkflows, attentionCount, archivedCount } = useMemo(() => {
    // Filter out archived workflows from main list
    const nonArchived = workflows.filter(w => w.status !== "archived");
    const archived = workflows.filter(w => w.status === "archived");

    const workflowsWithStatus = nonArchived.map(workflow => {
      const latestRun = latestRuns[workflow.id];
      const task = taskMap[workflow.task_id];
      const { text, isAttention, attentionLevel } = getSecondaryLine(workflow, latestRun, task, reconciliationCounts[workflow.id] || 0);
      // A workflow is "running" if it has a script run with no end_timestamp
      const isRunning = isScriptRunRunning(latestRun);
      return {
        ...workflow,
        secondaryText: text,
        needsAttention: isAttention,
        attentionLevel,
        isRunning,
        lastActivity: latestRun?.end_timestamp || latestRun?.start_timestamp || workflow.timestamp,
      };
    });

    // Sort: attention items first, then by last activity
    const sorted = [...workflowsWithStatus].sort((a, b) => {
      if (a.needsAttention && !b.needsAttention) return -1;
      if (!a.needsAttention && b.needsAttention) return 1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    const count = sorted.filter(w => w.needsAttention).length;
    return { sortedWorkflows: sorted, attentionCount: count, archivedCount: archived.length };
  }, [workflows, latestRuns, taskMap, reconciliationCounts]);

  // Filter workflows if showing attention only
  const displayedWorkflows = showAttentionOnly
    ? sortedWorkflows.filter(w => w.needsAttention)
    : sortedWorkflows;

  // Note: Tray badge updates are centralized in WorkflowNotifications.ts
  // which reacts to database changes for consistent badge state

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    // Synchronous check to prevent double-submit on rapid clicks
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setUploadWarning(null);

    try {
      const messageContent = message.text || "";
      let attachedFiles: DbFile[] = [];

      // Upload files if any are attached
      if (hasAttachments && message.files) {
        try {
          const files: File[] = [];
          for (const fileUIPart of message.files) {
            if (fileUIPart.url) {
              const response = await fetch(fileUIPart.url);
              const blob = await response.blob();
              const file = new File([blob], fileUIPart.filename || 'unknown', {
                type: fileUIPart.mediaType || 'application/octet-stream'
              });
              files.push(file);
            }
          }
          const uploadResults = await uploadFiles(files);
          attachedFiles = uploadResults;
        } catch (error) {
          console.error('File upload failed:', error);
          // Show warning but still proceed with task creation without file attachments
          setUploadWarning('Some files failed to upload and were not attached.');
        }
      }

      // Create task via mutation hook (triggers sync to server)
      const result = await createTask.mutateAsync({
        content: messageContent,
        files: attachedFiles,
      });

      // Navigate to the new chat
      navigate(`/chats/${result.chatId}`);
    } catch (error) {
      console.error('Failed to create task:', error);
      setSubmitError('Failed to create automation. Please try again.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [createTask, navigate, uploadFiles]);

  // Handle focus=input URL param (from Electron tray menu "New automation...")
  useEffect(() => {
    if (searchParams.get('focus') === 'input') {
      // Focus the textarea using the ref
      textareaRef.current?.focus();
      // Clear the URL param to allow re-triggering
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Shared input component to avoid duplication
  const renderPromptInput = () => (
    <>
      {/* Upload progress indicator */}
      {uploadState.isUploading && uploadState.uploadProgress && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between text-sm text-blue-600 mb-2">
            <span>Uploading {uploadState.uploadProgress.fileName}...</span>
            <span>{Math.round(uploadState.uploadProgress.progress)}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-200"
              style={{ width: `${uploadState.uploadProgress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Upload error indicator */}
      {uploadState.error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{uploadState.error}</p>
        </div>
      )}

      {/* Task creation error indicator */}
      {submitError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{submitError}</p>
        </div>
      )}

      {/* File upload warning (partial failure) */}
      {uploadWarning && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">{uploadWarning}</p>
        </div>
      )}

      <PromptInput
        onSubmit={handleSubmit}
        globalDrop
        multiple
      >
        <PromptInputBody>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
          <PromptInputTextarea
            ref={textareaRef}
            onChange={(e) => setInput(e.target.value)}
            value={input}
            placeholder="What would you like me to help automate?"
          />
        </PromptInputBody>
        <PromptInputToolbar>
          <PromptInputTools>
            <PromptInputButton
              onClick={() => {
                const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                fileInput?.click();
              }}
              aria-label="Add files"
            >
              <PlusIcon className="size-4" />
            </PromptInputButton>
            {/* TODO: re-enable autonomy mode toggle for v2
            {isAutonomyLoaded && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleAutonomyMode}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors py-1 px-2 rounded hover:bg-gray-100"
                    >
                      <span>{autonomyMode === 'ai_decides' ? 'AI decides' : 'Coordinate'}</span>
                      <Info className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="font-medium mb-1">
                      {autonomyMode === 'ai_decides' ? 'AI Decides Details' : 'Coordinate With Me'}
                    </p>
                    <p className="text-xs text-gray-600">
                      {autonomyMode === 'ai_decides'
                        ? 'The AI will minimize questions and use safe defaults to complete tasks quickly.'
                        : 'The AI will ask clarifying questions before proceeding with key decisions.'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Click to switch</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            */}
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!input || uploadState.isUploading || isSubmitting}
            status={uploadState.isUploading || isSubmitting ? "submitted" : undefined}
          />
        </PromptInputToolbar>
      </PromptInput>

      {/* Press Enter hint - shown when user has typed something */}
      {input.trim() && !uploadState.isUploading && !isSubmitting && (
        <div className="text-center text-xs text-gray-400 mt-2">
          Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200 font-mono">Enter</kbd> to create automation
        </div>
      )}
    </>
  );

  // Determine if we have workflows (non-empty state)
  const hasWorkflows = !isLoadingWorkflows && sortedWorkflows.length > 0;

  // Empty state: center input vertically with examples
  if (!hasWorkflows && !isLoadingWorkflows && !showAttentionOnly) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <SharedHeader title="Keep.AI" />

        {/* Centered content */}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-lg text-center">
            <Sparkles className="size-12 text-gray-300 mx-auto mb-4" />
            <div className="text-gray-700 text-lg font-medium mb-2">Create your first automation</div>
            <div className="text-gray-400 text-sm mb-6">
              Type below or try one of these examples
            </div>

            {/* Input area */}
            <div className="mb-6">
              {renderPromptInput()}
            </div>

            {/* Example suggestions */}
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_SUGGESTIONS.map((suggestion, index) => (
                <Suggestion
                  key={index}
                  suggestion={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="text-xs"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // With workflows: input at top, then workflow list
  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Keep.AI" />

      <div className="pt-6 pb-6">
        <div className="max-w-4xl mx-auto px-6">
          {/* Create new automation section */}
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Create new automation</h2>
            {renderPromptInput()}
          </div>

          {/* Stale Drafts Banner - prompts user about incomplete automations */}
          <StaleDraftsBanner />

          {/* Attention Banner */}
          {attentionCount > 0 && (
            <button
              onClick={() => setShowAttentionOnly(!showAttentionOnly)}
              className={`w-full mb-6 p-3 rounded-lg border flex items-center gap-2 transition-colors ${
                showAttentionOnly
                  ? "bg-red-100 border-red-300 text-red-800"
                  : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
              }`}
            >
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">
                {attentionCount} {attentionCount === 1 ? "workflow needs" : "workflows need"} attention
              </span>
              {showAttentionOnly && (
                <span className="ml-auto text-sm">Click to show all</span>
              )}
            </button>
          )}

          {/* Workflows section */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 mb-3">Workflows</h2>

            {isLoadingWorkflows ? (
              <div className="flex items-center justify-center py-8">
                <div>Loading workflows...</div>
              </div>
            ) : displayedWorkflows.length === 0 && showAttentionOnly ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-gray-500 mb-2">No workflows need attention</div>
                <div className="text-gray-400 text-sm">All automations are running smoothly</div>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedWorkflows.map((workflow) => (
                  <Link
                    key={workflow.id}
                    to={`/workflows/${workflow.id}`}
                    className={`block p-4 bg-white rounded-lg border transition-all hover:shadow-sm ${
                      workflow.attentionLevel === "error"
                        ? "border-l-4 border-l-red-500 border-t-gray-200 border-r-gray-200 border-b-gray-200"
                        : workflow.attentionLevel === "warning"
                        ? "border-l-4 border-l-amber-500 border-t-gray-200 border-r-gray-200 border-b-gray-200"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-900">
                            {getWorkflowTitle(workflow)}
                          </h3>
                          <WorkflowStatusBadge status={workflow.status} />
                          {workflow.isRunning && (
                            <Badge className="bg-blue-100 text-blue-800">Running</Badge>
                          )}
                        </div>
                        <div className={`text-sm ${
                          workflow.attentionLevel === "error" ? "text-red-600"
                          : workflow.attentionLevel === "warning" ? "text-amber-600"
                          : "text-gray-500"
                        }`}>
                          {workflow.cron && (
                            <span className="text-gray-400">{formatCronSchedule(workflow.cron)} · </span>
                          )}
                          {workflow.secondaryText}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}

                {/* Link to archived workflows if any exist */}
                {archivedCount > 0 && (
                  <Link
                    to="/archived"
                    className="block text-center py-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    View {archivedCount} archived workflow{archivedCount !== 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
