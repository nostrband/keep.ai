import React, { useState, useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  Circle,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { useWorkflow } from "../hooks/dbScriptReads";
import {
  useWorkflowInputs,
  useWorkflowStaleInputs,
} from "../hooks/dbInputReads";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";
import { getWorkflowTitle } from "../lib/workflowUtils";
import type { InputWithStatus, InputStatus } from "@app/db";

type FilterStatus = "all" | InputStatus;

/**
 * Status indicator icon component.
 */
function StatusIcon({ status }: { status: InputStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="w-4 h-4 text-yellow-500 fill-yellow-500" />;
    case "done":
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case "skipped":
      return <XCircle className="w-4 h-4 text-gray-400" />;
    default:
      return <Circle className="w-4 h-4 text-gray-400" />;
  }
}

/**
 * Format a timestamp for display.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Get display name for source/type combination.
 */
function formatSourceType(source: string, type: string): string {
  const sourceMap: Record<string, string> = {
    gmail: "Gmail",
    slack: "Slack",
    sheets: "Google Sheets",
    calendar: "Google Calendar",
    drive: "Google Drive",
    github: "GitHub",
    notion: "Notion",
    trello: "Trello",
    asana: "Asana",
    jira: "Jira",
    webhook: "Webhook",
    http: "HTTP",
    rss: "RSS Feed",
    email: "Email",
  };

  const typeMap: Record<string, string> = {
    email: "Email",
    message: "Message",
    row: "Row",
    event: "Event",
    file: "File",
    issue: "Issue",
    pr: "Pull Request",
    task: "Task",
    page: "Page",
    item: "Item",
    notification: "Notification",
    webhook: "Webhook",
    request: "Request",
  };

  const displaySource = sourceMap[source.toLowerCase()] || source;
  const displayType = typeMap[type.toLowerCase()] || type;

  return `${displaySource} / ${displayType}`;
}

/**
 * Calculate the "age" of a pending input for stale warnings.
 */
function getPendingAge(input: InputWithStatus, staleThresholdMs: number): string | null {
  if (input.status !== "pending") return null;

  const age = Date.now() - input.created_at;
  if (age < staleThresholdMs) return null;

  const days = Math.floor(age / (1000 * 60 * 60 * 24));
  return `pending ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Inputs list view for a workflow (exec-16).
 *
 * Shows all inputs for a workflow with:
 * - Status indicators (pending/done/skipped)
 * - Filtering by status and source/type
 * - Stale input warnings
 * - Click to view input details
 */
export default function WorkflowInputsPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Get source/type filters from URL params (from dashboard click)
  const sourceFilter = searchParams.get("source");
  const typeFilter = searchParams.get("type");
  const attentionFilter = searchParams.get("attention") === "true";

  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(workflowId!);
  const { data: inputs = [], isLoading: isLoadingInputs } = useWorkflowInputs(workflowId!);
  const { data: staleInputs = [] } = useWorkflowStaleInputs(workflowId!);

  // Track stale input IDs for highlighting
  const staleInputIds = useMemo(
    () => new Set(staleInputs.map((i) => i.id)),
    [staleInputs]
  );

  // Apply filters
  const filteredInputs = useMemo(() => {
    let result = inputs;

    // Filter by status
    if (statusFilter !== "all") {
      result = result.filter((i) => i.status === statusFilter);
    }

    // Filter by source/type from URL
    if (sourceFilter) {
      result = result.filter((i) => i.source === sourceFilter);
    }
    if (typeFilter) {
      result = result.filter((i) => i.type === typeFilter);
    }

    // Filter by attention needed (stale inputs)
    if (attentionFilter) {
      result = result.filter((i) => staleInputIds.has(i.id));
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(query) ||
          i.source.toLowerCase().includes(query) ||
          i.type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [inputs, statusFilter, sourceFilter, typeFilter, attentionFilter, searchQuery, staleInputIds]);

  // Count by status for filter buttons
  const statusCounts = useMemo(() => {
    const counts = { all: inputs.length, pending: 0, done: 0, skipped: 0 };
    for (const input of inputs) {
      counts[input.status]++;
    }
    return counts;
  }, [inputs]);

  const staleThresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  if (!workflowId) {
    return <div>Workflow ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Workflows"
        subtitle={workflow ? `${getWorkflowTitle(workflow)} - Inputs` : "Inputs"}
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
          {/* Header with title and filter info */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {sourceFilter && typeFilter
                  ? formatSourceType(sourceFilter, typeFilter)
                  : attentionFilter
                  ? "Inputs Needing Attention"
                  : "All Inputs"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {filteredInputs.length} input{filteredInputs.length === 1 ? "" : "s"}
                {statusFilter !== "all" && ` (${statusFilter})`}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-6 pb-4 border-b border-gray-200">
            {/* Status filter buttons */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                <Filter className="w-4 h-4 inline mr-1" />
                Status:
              </span>
              <div className="flex gap-1">
                {(["all", "pending", "done", "skipped"] as const).map((status) => (
                  <Button
                    key={status}
                    variant={statusFilter === status ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter(status)}
                    className="cursor-pointer text-xs"
                  >
                    {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                    <span className="ml-1 text-gray-400">({statusCounts[status]})</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Search input */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search inputs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Inputs list */}
          {isLoadingWorkflow || isLoadingInputs ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">Loading inputs...</div>
            </div>
          ) : filteredInputs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">
                {inputs.length === 0
                  ? "No inputs recorded yet"
                  : "No inputs match the current filters"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInputs.map((input) => {
                const isStale = staleInputIds.has(input.id);
                const pendingAge = getPendingAge(input, staleThresholdMs);

                return (
                  <Link
                    key={input.id}
                    to={`/workflow/${workflowId}/input/${input.id}`}
                    className={`block p-4 border rounded-lg transition-all group ${
                      isStale
                        ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                        : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <StatusIcon status={input.status} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 truncate">
                              {input.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{formatSourceType(input.source, input.type)}</span>
                            <span>•</span>
                            <span>{formatTimestamp(input.created_at)}</span>
                            {isStale && pendingAge && (
                              <>
                                <span>•</span>
                                <span className="text-amber-600 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {pendingAge}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Badge
                          variant="outline"
                          className={
                            input.status === "pending"
                              ? "text-yellow-700 border-yellow-300 bg-yellow-50"
                              : input.status === "done"
                              ? "text-green-700 border-green-300 bg-green-50"
                              : "text-gray-600 border-gray-300 bg-gray-50"
                          }
                        >
                          {input.status}
                        </Badge>
                        <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
