import React from "react";
import { Badge } from "../ui";

// Workflow status badge - based on workflow.status field
export function WorkflowStatusBadge({ status }: { status: string }) {
  if (status === "disabled") {
    return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
  } else if (status === "active") {
    return <Badge className="bg-green-100 text-green-800">Running</Badge>;
  } else {
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
