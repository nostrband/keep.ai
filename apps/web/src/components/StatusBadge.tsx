import React from "react";
import { Badge } from "../ui";

// Workflow status badge - based on workflow.status field
// Status values: 'draft', 'ready', 'active', 'paused', 'error' (Spec 11)
export function WorkflowStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-100 text-green-800">Active</Badge>;
    case "paused":
      return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-800">Error</Badge>;
    case "ready":
      return <Badge className="bg-blue-100 text-blue-800">Ready</Badge>;
    case "draft":
    default:
      return <Badge variant="outline">Draft</Badge>;
  }
}

// Task status badge - based on task.state field
// defaultLabel is used when state doesn't match known values (context-dependent)
export function TaskStatusBadge({ state, defaultLabel = "Unknown" }: { state: string; defaultLabel?: string }) {
  if (state === "finished") {
    return <Badge variant="default" className="bg-green-100 text-green-800">Finished</Badge>;
  } else if (state === "error") {
    return <Badge variant="destructive">Error</Badge>;
  } else if (state === "wait") {
    return <Badge variant="secondary">Waiting</Badge>;
  } else if (state === "asks") {
    return <Badge variant="secondary">Asking</Badge>;
  } else {
    return <Badge variant="outline">{defaultLabel}</Badge>;
  }
}

// Task run status badge - based on taskRun.state field
export function TaskRunStatusBadge({ state }: { state: string }) {
  if (state === "done") {
    return <Badge variant="default" className="bg-green-100 text-green-800">Done</Badge>;
  } else if (state === "error") {
    return <Badge variant="destructive">Error</Badge>;
  } else if (state === "wait") {
    return <Badge variant="secondary">Wait</Badge>;
  } else {
    return <Badge variant="outline">Pending</Badge>;
  }
}

// Script run status badge - based on script run's error/end_timestamp fields
// Supports optional size prop for different contexts (compact lists vs headers)
// Labels can be customized for context (e.g., "Failed"/"Success" for retry lists)
export function ScriptRunStatusBadge({
  error,
  endTimestamp,
  size = "default",
  labels = { error: "Error", success: "Completed", running: "Running" }
}: {
  error?: string | null;
  endTimestamp?: string | null;
  size?: "default" | "small";
  labels?: { error: string; success: string; running: string };
}) {
  const sizeClass = size === "small" ? "text-xs" : "";

  if (error) {
    return <Badge variant="destructive" className={sizeClass}>{labels.error}</Badge>;
  } else if (endTimestamp) {
    return <Badge variant="default" className={`bg-green-100 text-green-800 ${sizeClass}`}>{labels.success}</Badge>;
  } else {
    return <Badge variant="secondary" className={sizeClass}>{labels.running}</Badge>;
  }
}
