import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflows } from "../hooks/dbScriptReads";
import { useTasks } from "../hooks/dbTaskReads";
import { useAddMessage } from "../hooks/dbWrites";
import { useFileUpload } from "../hooks/useFileUpload";
import { useDbQuery } from "../hooks/dbQuery";
import { useAutonomyPreference } from "../hooks/useAutonomyPreference";
import SharedHeader from "./SharedHeader";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui";
import { PlusIcon, AlertCircle, Info } from "lucide-react";
import type { FileUIPart } from "ai";
import type { File as DbFile } from "@app/db";

type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

// Status badge component for workflows
const getStatusBadge = (workflow: any) => {
  if (workflow.status === "disabled") {
    return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
  } else if (workflow.status === "active") {
    return <Badge className="bg-green-100 text-green-800">Running</Badge>;
  } else {
    return <Badge variant="outline">Draft</Badge>;
  }
};

// Error types that require user attention (non-fixable)
// Logic errors are handled silently by the agent via maintenance mode
const ATTENTION_ERROR_TYPES = ['auth', 'permission', 'network'];

// Compute secondary line text for workflow
function getSecondaryLine(workflow: any, latestRun: any, task: any): { text: string; isAttention: boolean } {
  // Check if task is waiting for input
  if (task && (task.state === "wait" || task.state === "asks")) {
    return { text: "Waiting for your input", isAttention: true };
  }

  // Check if workflow is in maintenance mode (agent is auto-fixing)
  // Per spec 09b: Logic errors are handled silently, don't show as needing attention
  if (workflow.maintenance) {
    return { text: "Auto-fixing issue...", isAttention: false };
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
          return { text: `⚠ Authentication expired ${ago}`, isAttention: true };
        } else if (errorType === 'permission') {
          return { text: `⚠ Permission denied ${ago}`, isAttention: true };
        } else if (errorType === 'network') {
          return { text: `⚠ Network error ${ago}`, isAttention: true };
        }
        return { text: `⚠ Failed ${ago} - needs attention`, isAttention: true };
      } else {
        // Logic error - agent is handling it
        return { text: `Issue detected ${ago} - fixing...`, isAttention: false };
      }
    }

    if (latestRun.end_timestamp) {
      const runTime = new Date(latestRun.end_timestamp);
      const ago = formatTimeAgo(runTime);
      return { text: `Last run: ${ago} ✓`, isAttention: false };
    }

    // Still running
    return { text: "Running now...", isAttention: false };
  }

  // Check next run time
  if (workflow.next_run_timestamp && workflow.status === "active") {
    const nextRun = new Date(workflow.next_run_timestamp);
    if (nextRun > new Date()) {
      return { text: `Next run: ${formatNextRun(nextRun)}`, isAttention: false };
    }
  }

  // Check if scheduled
  if (!workflow.cron && !workflow.events) {
    return { text: "Not scheduled", isAttention: false };
  }

  return { text: workflow.cron || workflow.events || "No schedule", isAttention: false };
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
  const { api } = useDbQuery();
  const { data: workflows = [], isLoading: isLoadingWorkflows } = useWorkflows();
  const { data: tasks = [] } = useTasks(false); // Get non-finished tasks
  const { mode: autonomyMode, toggleMode: toggleAutonomyMode, isLoaded: isAutonomyLoaded } = useAutonomyPreference();
  const [input, setInput] = useState("");
  const [promptHeight, setPromptHeight] = useState(0);
  const [latestRuns, setLatestRuns] = useState<Record<string, any>>({});
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const promptContainerRef = useRef<HTMLDivElement>(null);
  const addMessage = useAddMessage();
  const { uploadFiles, uploadState } = useFileUpload();

  // Fetch latest run for each workflow
  useEffect(() => {
    if (!api || workflows.length === 0) return;

    const fetchRuns = async () => {
      const runs: Record<string, any> = {};
      for (const workflow of workflows) {
        try {
          const workflowRuns = await api.scriptStore.getScriptRunsByWorkflowId(workflow.id);
          if (workflowRuns.length > 0) {
            runs[workflow.id] = workflowRuns[0]; // Latest run
          }
        } catch {
          // Ignore errors
        }
      }
      setLatestRuns(runs);
    };

    fetchRuns();
  }, [api, workflows]);

  // Create a map of task_id to task for quick lookup
  const taskMap = useMemo(() => {
    const map: Record<string, any> = {};
    for (const task of tasks) {
      map[task.id] = task;
    }
    return map;
  }, [tasks]);

  // Compute attention count and sort workflows
  const { sortedWorkflows, attentionCount } = useMemo(() => {
    const workflowsWithStatus = workflows.map(workflow => {
      const latestRun = latestRuns[workflow.id];
      const task = taskMap[workflow.task_id];
      const { text, isAttention } = getSecondaryLine(workflow, latestRun, task);
      return {
        ...workflow,
        secondaryText: text,
        needsAttention: isAttention,
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
    return { sortedWorkflows: sorted, attentionCount: count };
  }, [workflows, latestRuns, taskMap]);

  // Filter workflows if showing attention only
  const displayedWorkflows = showAttentionOnly
    ? sortedWorkflows.filter(w => w.needsAttention)
    : sortedWorkflows;

  // Update tray badge when attention count changes (Electron only)
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.updateTrayBadge(attentionCount).catch(() => {
        // Ignore errors - this is optional functionality
      });
    }
  }, [attentionCount]);

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

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
      }
    }

    // Send the message to the main chat
    addMessage.mutate({
      chatId: "main",
      role: "user",
      content: messageContent,
      files: attachedFiles,
    });

    setInput("");
  }, [addMessage, uploadFiles]);

  // Track prompt input height changes
  useEffect(() => {
    const container = promptContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPromptHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    setPromptHeight(container.getBoundingClientRect().height);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Keep.AI" />

      {/* Main content with bottom padding for fixed input */}
      <div
        className="pt-6 transition-[padding-bottom] duration-200 ease-out"
        style={{ paddingBottom: Math.max(144, promptHeight + 32) }}
      >
        <div className="max-w-4xl mx-auto px-6">
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

          {/* Workflow List */}
          {isLoadingWorkflows ? (
            <div className="flex items-center justify-center py-8">
              <div>Loading workflows...</div>
            </div>
          ) : displayedWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-gray-500 mb-2">
                {showAttentionOnly ? "No workflows need attention" : "No automations yet"}
              </div>
              <div className="text-gray-400 text-sm">
                Type below to create your first automation
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedWorkflows.map((workflow) => (
                <Link
                  key={workflow.id}
                  to={`/workflows/${workflow.id}`}
                  className={`block p-4 bg-white rounded-lg border transition-all hover:shadow-sm ${
                    workflow.needsAttention
                      ? "border-l-4 border-l-red-500 border-t-gray-200 border-r-gray-200 border-b-gray-200"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-gray-900">
                          {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
                        </h3>
                        {getStatusBadge(workflow)}
                      </div>
                      <div className={`text-sm ${
                        workflow.needsAttention ? "text-red-600" : "text-gray-500"
                      }`}>
                        {workflow.secondaryText}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed prompt input at viewport bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-gray-50 border-t border-gray-200">
        <div ref={promptContainerRef} className="max-w-4xl mx-auto px-6 py-4">
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
              </PromptInputTools>
              <PromptInputSubmit
                disabled={(!input && !uploadState.isUploading) || uploadState.isUploading}
                status={uploadState.isUploading ? "submitted" : undefined}
              />
            </PromptInputToolbar>
          </PromptInput>

          {/* Autonomy Toggle */}
          {isAutonomyLoaded && (
            <div className="mt-2 flex justify-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleAutonomyMode}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors py-1 px-2 rounded hover:bg-gray-100"
                    >
                      <span>{autonomyMode === 'ai_decides' ? 'AI decides details' : 'Coordinate with me'}</span>
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-center">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
