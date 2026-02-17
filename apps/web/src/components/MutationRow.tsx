import React from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Badge } from "../ui";
import type { Mutation, MutationStatus } from "@app/db";

/**
 * Status icon for mutations.
 */
export function MutationStatusIcon({ status }: { status: MutationStatus }) {
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
 * Get display title for a mutation.
 */
export function getMutationTitle(mutation: Mutation, fallback = "Output"): string {
  if (mutation.ui_title) {
    return mutation.ui_title;
  }
  if (mutation.tool_namespace && mutation.tool_method) {
    return `${mutation.tool_namespace}.${mutation.tool_method}`;
  }
  return fallback;
}

/**
 * Status badge for mutations.
 */
export function MutationStatusBadge({ status }: { status: MutationStatus }) {
  return (
    <Badge
      variant="outline"
      className={
        status === "applied"
          ? "text-green-700 border-green-300 bg-green-50"
          : status === "failed"
          ? "text-red-700 border-red-300"
          : status === "indeterminate"
          ? "text-amber-700 border-amber-300"
          : status === "pending" || status === "in_flight"
          ? "text-yellow-700 border-yellow-300"
          : "text-gray-600 border-gray-300"
      }
    >
      {status}
    </Badge>
  );
}

/**
 * Expand/collapse chevron indicator.
 */
export function ExpandChevron({ expanded }: { expanded: boolean }) {
  return expanded
    ? <ChevronDown className="w-4 h-4 text-gray-400" />
    : <ChevronRight className="w-4 h-4 text-gray-400" />;
}

/**
 * Expandable result panel showing mutation result as pretty JSON.
 */
export function MutationResultPanel({ mutation }: { mutation: Mutation }) {
  return (
    <div className="px-4 pb-4 border-t border-gray-200">
      <div className="mt-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Result</span>
        <pre className="mt-1 p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap break-words">
          {mutation.result
            ? (() => {
                try {
                  return JSON.stringify(JSON.parse(mutation.result), null, 2);
                } catch {
                  return mutation.result;
                }
              })()
            : <span className="text-gray-400 italic">No result</span>
          }
        </pre>
      </div>
    </div>
  );
}
