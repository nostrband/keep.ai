import React, { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Circle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { useWorkflow } from "../hooks/dbScriptReads";
import {
  useInput,
  useInputMutations,
  useInputEvents,
} from "../hooks/dbInputReads";
import SharedHeader from "./SharedHeader";
import { Badge } from "../ui";
import { getWorkflowTitle } from "../lib/workflowUtils";
import type { Mutation, MutationStatus, EventStatus } from "@app/db";

/**
 * Format a timestamp for display.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Get short time format for mutation list.
 */
function formatShortTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();

  if (isSameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

/**
 * Get display name for source/type combination.
 * Values come from validated tool metadata (namespace + outputType).
 */
function formatSourceType(source: string, type: string): string {
  return `${source} / ${type}`;
}

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
    case "pending":
    case "in_flight":
      return <Circle className="w-4 h-4 text-yellow-500 animate-pulse" />;
    default:
      return <Circle className="w-4 h-4 text-gray-400" />;
  }
}

/**
 * Compute the overall status of an input based on its events.
 */
function computeInputStatus(events: Array<{ status: EventStatus }>): {
  status: "pending" | "done" | "skipped";
  label: string;
} {
  if (events.length === 0) {
    return { status: "done", label: "Done" };
  }

  const hasPending = events.some((e) => e.status === "pending" || e.status === "reserved");
  const allSkipped = events.every((e) => e.status === "skipped");

  if (hasPending) {
    return { status: "pending", label: "Pending" };
  }
  if (allSkipped) {
    return { status: "skipped", label: "Skipped" };
  }
  return { status: "done", label: "Done" };
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

  return "Mutation";
}

/**
 * Input detail view (exec-16).
 *
 * Shows:
 * - Input metadata (source, type, title, received time)
 * - Status badge
 * - List of mutations caused by this input
 * - Each mutation shows ui_title, status, timestamp
 */
export default function InputDetailPage() {
  const { id: workflowId, inputId } = useParams<{ id: string; inputId: string }>();
  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(workflowId!);
  const { data: input, isLoading: isLoadingInput } = useInput(inputId!);
  const { data: mutations = [], isLoading: isLoadingMutations } = useInputMutations(inputId!);
  const { data: events = [], isLoading: isLoadingEvents } = useInputEvents(inputId!);

  // Compute status from events
  const inputStatus = useMemo(() => computeInputStatus(events), [events]);

  // Group mutations by status for display order
  const sortedMutations = useMemo(() => {
    // Sort: in-progress first, then applied, then failed, then indeterminate
    const statusOrder: Record<MutationStatus, number> = {
      pending: 0,
      in_flight: 0,
      applied: 1,
      failed: 2,
      indeterminate: 3,
      needs_reconcile: 4,
    };
    return [...mutations].sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 5;
      const orderB = statusOrder[b.status] ?? 5;
      if (orderA !== orderB) return orderA - orderB;
      return b.created_at - a.created_at; // Most recent first within same status
    });
  }, [mutations]);

  const isLoading = isLoadingWorkflow || isLoadingInput || isLoadingMutations || isLoadingEvents;

  if (!workflowId || !inputId) {
    return <div>Input ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Workflows"
        subtitle={workflow ? `${getWorkflowTitle(workflow)} - Input Detail` : "Input Detail"}
      />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Back link */}
        <Link
          to={`/workflow/${workflowId}/inputs`}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to inputs
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading input details...</div>
          </div>
        ) : !input ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Input not found</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Input Header Card */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 flex-1 pr-4">
                  {input.title}
                </h2>
                <Badge
                  className={
                    inputStatus.status === "pending"
                      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                      : inputStatus.status === "done"
                      ? "bg-green-100 text-green-800 border-green-300"
                      : "bg-gray-100 text-gray-600 border-gray-300"
                  }
                >
                  {inputStatus.label} {inputStatus.status === "done" && "✓"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Source</h3>
                  <p className="text-gray-900">{formatSourceType(input.source, input.type)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Received</h3>
                  <p className="text-gray-900">{formatTimestamp(input.created_at)}</p>
                </div>
              </div>
            </div>

            {/* What Happened Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">What happened</h2>

              {sortedMutations.length === 0 ? (
                <div className="text-gray-500 text-sm">
                  {inputStatus.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 animate-pulse" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    "No external changes"
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedMutations.map((mutation) => (
                    <div
                      key={mutation.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        mutation.status === "indeterminate"
                          ? "border-amber-300 bg-amber-50"
                          : mutation.status === "failed"
                          ? "border-red-200 bg-red-50"
                          : "border-gray-200"
                      }`}
                    >
                      <MutationStatusIcon status={mutation.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900 truncate">
                            {getMutationTitle(mutation)}
                          </span>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {formatShortTime(mutation.created_at)}
                          </span>
                        </div>

                        {/* Show status details for non-applied mutations */}
                        {mutation.status === "pending" || mutation.status === "in_flight" ? (
                          <p className="text-sm text-yellow-600 mt-1">Processing...</p>
                        ) : mutation.status === "failed" && mutation.error ? (
                          <p className="text-sm text-red-600 mt-1 line-clamp-2">
                            {mutation.error}
                          </p>
                        ) : mutation.status === "indeterminate" ? (
                          <p className="text-sm text-amber-600 mt-1">
                            Uncertain outcome - needs verification
                          </p>
                        ) : null}

                        {/* Show tool info */}
                        {mutation.tool_namespace && mutation.tool_method && (
                          <p className="text-xs text-gray-500 mt-1">
                            {mutation.tool_namespace}.{mutation.tool_method}
                          </p>
                        )}
                      </div>

                      {/* Status badge */}
                      <Badge
                        variant="outline"
                        className={
                          mutation.status === "applied"
                            ? "text-green-700 border-green-300"
                            : mutation.status === "failed"
                            ? "text-red-700 border-red-300"
                            : mutation.status === "indeterminate"
                            ? "text-amber-700 border-amber-300"
                            : "text-yellow-700 border-yellow-300"
                        }
                      >
                        {mutation.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Events Section (debug info) */}
            {events.length > 0 && (
              <details className="bg-white rounded-lg border border-gray-200 p-6">
                <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                  Internal events ({events.length})
                </summary>
                <div className="mt-4 space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-500">
                          {event.id.slice(0, 8)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {event.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatShortTime(event.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
