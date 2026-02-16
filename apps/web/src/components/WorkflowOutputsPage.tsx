import React, { useState, useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Filter,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { useWorkflow } from "../hooks/dbScriptReads";
import { useWorkflowMutations } from "../hooks/dbInputReads";
import { useResolveMutation } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { Badge, Button } from "../ui";
import { getWorkflowTitle } from "../lib/workflowUtils";
import type { Mutation, MutationStatus } from "@app/db";

type FilterStatus = "all" | "applied" | "failed" | "indeterminate";

/**
 * Status icon for mutations.
 */
function MutationStatusIcon({ status }: { status: MutationStatus }) {
  switch (status) {
    case "applied":
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-600" />;
    case "indeterminate":
      return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-gray-400" />;
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
 * Get display name for a connector namespace.
 * Values come from validated tool metadata (namespace).
 */
function formatConnector(namespace: string): string {
  return namespace;
}

/**
 * Get display title for a mutation.
 */
function getMutationTitle(mutation: Mutation): string {
  if (mutation.ui_title) {
    return mutation.ui_title;
  }

  // Fallback to tool namespace/method if no ui_title
  if (mutation.tool_namespace && mutation.tool_method) {
    return `${mutation.tool_namespace}.${mutation.tool_method}`;
  }

  return "Output";
}

/**
 * Outputs list view for a workflow (exec-16).
 *
 * Shows all mutations (outputs) for a workflow with:
 * - Status indicators (applied/failed/indeterminate)
 * - Filtering by status and connector
 * - Click to view details
 */
export default function WorkflowOutputsPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Get connector filter from URL params (from dashboard click)
  const connectorFilter = searchParams.get("connector");

  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(workflowId!);
  const { data: mutations = [], isLoading: isLoadingMutations } = useWorkflowMutations(workflowId!);
  const resolveMutation = useResolveMutation();

  // Filter to only completed mutations (not pending/in_flight)
  const completedMutations = useMemo(
    () => mutations.filter((m) => m.tool_namespace !== ""), // Only show mutations with tool info
    [mutations]
  );

  // Apply filters
  const filteredMutations = useMemo(() => {
    let result = completedMutations;

    // Filter by status
    if (statusFilter !== "all") {
      result = result.filter((m) => m.status === statusFilter);
    }

    // Filter by connector from URL
    if (connectorFilter) {
      result = result.filter((m) => m.tool_namespace === connectorFilter);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          (m.ui_title && m.ui_title.toLowerCase().includes(query)) ||
          m.tool_namespace.toLowerCase().includes(query) ||
          m.tool_method.toLowerCase().includes(query)
      );
    }

    return result;
  }, [completedMutations, statusFilter, connectorFilter, searchQuery]);

  // Count by status for filter buttons
  const statusCounts = useMemo(() => {
    const counts = { all: completedMutations.length, applied: 0, failed: 0, indeterminate: 0 };
    for (const mutation of completedMutations) {
      if (mutation.status === "applied") counts.applied++;
      else if (mutation.status === "failed") counts.failed++;
      else if (mutation.status === "indeterminate") counts.indeterminate++;
    }
    return counts;
  }, [completedMutations]);

  if (!workflowId) {
    return <div>Workflow ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Workflows"
        subtitle={workflow ? `${getWorkflowTitle(workflow)} - Outputs` : "Outputs"}
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
                {connectorFilter
                  ? `Outputs: ${formatConnector(connectorFilter)}`
                  : "All Outputs"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {filteredMutations.length} output{filteredMutations.length === 1 ? "" : "s"}
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
                {(["all", "applied", "failed", "indeterminate"] as const).map((status) => (
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
                placeholder="Search outputs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Mutations list */}
          {isLoadingWorkflow || isLoadingMutations ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">Loading outputs...</div>
            </div>
          ) : filteredMutations.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">
                {completedMutations.length === 0
                  ? "No outputs recorded yet"
                  : "No outputs match the current filters"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMutations.map((mutation) => (
                <div
                  key={mutation.id}
                  className={`block p-4 border rounded-lg transition-all ${
                    mutation.status === "indeterminate"
                      ? "border-amber-300 bg-amber-50"
                      : mutation.status === "failed"
                      ? "border-red-200 bg-red-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <MutationStatusIcon status={mutation.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 truncate">
                            {getMutationTitle(mutation)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{formatConnector(mutation.tool_namespace)}</span>
                          <span>•</span>
                          <span>{mutation.tool_method}</span>
                          <span>•</span>
                          <span>{formatTimestamp(mutation.created_at)}</span>
                        </div>
                        {/* Show error for failed mutations */}
                        {mutation.status === "failed" && mutation.error && (
                          <p className="text-sm text-red-600 mt-2 line-clamp-2">
                            {mutation.error}
                          </p>
                        )}
                        {/* Show warning + action buttons for indeterminate mutations */}
                        {mutation.status === "indeterminate" && (
                          <div className="mt-2">
                            <p className="text-sm text-amber-600">
                              Uncertain outcome - needs verification
                            </p>
                            <div className="flex gap-2 mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="cursor-pointer text-xs border-red-300 text-red-700 hover:bg-red-50"
                                disabled={resolveMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  resolveMutation.mutate({ mutation, action: "did_not_happen" });
                                }}
                              >
                                It didn't happen
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="cursor-pointer text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                                disabled={resolveMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  resolveMutation.mutate({ mutation, action: "skip" });
                                }}
                              >
                                Skip
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Badge
                        variant="outline"
                        className={
                          mutation.status === "applied"
                            ? "text-green-700 border-green-300 bg-green-50"
                            : mutation.status === "failed"
                            ? "text-red-700 border-red-300"
                            : mutation.status === "indeterminate"
                            ? "text-amber-700 border-amber-300"
                            : "text-gray-600 border-gray-300"
                        }
                      >
                        {mutation.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
