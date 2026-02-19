/**
 * @deprecated Chat workflow events are no longer produced. This component
 * is wired into ChatInterface but never renders in practice. Will be removed
 * entirely in a future cleanup pass along with the chat event grouping logic.
 */
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflow, useScriptRun } from "../hooks/dbScriptReads";
import { EventListWithCollapse } from "./EventListWithCollapse";
import { processEventsForDisplay } from "../lib/event-helpers";
import { calculateEventsCost } from "../lib/eventSignal";

interface WorkflowEvent {
  id: string;
  type: string;
  content: any;
  timestamp: string;
}

interface WorkflowEventGroupProps {
  workflowId: string;
  scriptId?: string;
  scriptRunId?: string;
  events: WorkflowEvent[];
}

export function WorkflowEventGroup({ workflowId, scriptId, scriptRunId, events }: WorkflowEventGroupProps) {
  const navigate = useNavigate();
  const { data: workflow } = useWorkflow(workflowId);
  const { data: scriptRun } = useScriptRun(scriptRunId || "");

  const handleViewWorkflow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/workflows/${workflowId}`);
  };

  const workflowTitle = workflow?.title || `Workflow ${workflowId.slice(0, 8)}`;

  // Determine the link URL
  const linkUrl = scriptId && scriptRunId
    ? `/scripts/${scriptId}/runs/${scriptRunId}`
    : `/workflows/${workflowId}`;

  // Get cost from events with usage.cost
  const totalCost = calculateEventsCost(events);

  // Process events: filter out markers and consolidate Gmail events
  const allVisibleEvents = processEventsForDisplay(events, ["workflow_run", "workflow_run_end"]);

  // Determine if this run has an error (for header styling)
  const hasError = !!(scriptRun?.error && scriptRun.error.length > 0);

  // Check if this is an empty group (only workflow_run events)
  const isEmpty = allVisibleEvents.length === 0;

  // Error styling: red left border on container, error-tinted header
  const containerClass = `mx-0 my-3 border bg-gray-50 rounded-lg ${
    hasError ? "border-red-200 border-l-4 border-l-red-500" : "border-gray-200"
  }`;

  const headerClass = `flex items-center justify-between px-2 py-0 ${
    hasError ? "bg-red-50" : "bg-gray-50"
  } ${isEmpty ? "rounded-lg" : "border-b border-gray-200 rounded-t-lg"} hover:brightness-95 cursor-pointer transition-colors duration-200`;

  return (
    <div className={containerClass}>
      {/* Workflow Title Header */}
      <Link to={linkUrl} className={headerClass}>
        <div className="flex items-center flex-1 min-w-0 gap-2">
          <span className="text-sm text-gray-600">
            ⚙ Executing: <span className="text-gray-600">{workflowTitle}</span>
          </span>
          {/* Metadata: cost */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {totalCost > 0 && (
              <span className="flex items-center gap-1">
                <span>💵</span>
                <span>{totalCost.toFixed(2)}</span>
              </span>
            )}
          </div>
        </div>

        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleViewWorkflow(e); }}
          className="ml-2 px-2 py-1 text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          View workflow
        </button>
      </Link>

      {/* Events List - only show if there are visible events */}
      {!isEmpty && (
        <EventListWithCollapse events={allVisibleEvents} hasError={hasError} />
      )}
    </div>
  );
}
