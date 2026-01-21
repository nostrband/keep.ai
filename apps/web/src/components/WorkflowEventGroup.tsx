import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflow, useScriptRun } from "../hooks/dbScriptReads";
import { useUpdateWorkflow } from "../hooks/dbWrites";
import { EventItem } from "./EventItem";
import { CollapsedEventSummary } from "./CollapsedEventSummary";
import {
  EventType,
  EventPayload,
  GmailApiCallEventPayload,
  EVENT_TYPES,
} from "../types/events";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui";
import { transformGmailMethod } from "../lib/event-helpers";
import { partitionEventsBySignal } from "../lib/eventSignal";
import { useAutoHidingMessage } from "../hooks/useAutoHidingMessage";

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
  const updateWorkflowMutation = useUpdateWorkflow();
  const success = useAutoHidingMessage({ duration: 3000 });
  const [isLowSignalCollapsed, setIsLowSignalCollapsed] = useState(true);

  const handleRetry = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!workflow) return;

    // Only allow retry for active workflows - scheduler only executes where status === 'active'
    if (workflow.status !== 'active') {
      success.show("Enable workflow first to retry");
      return;
    }

    // Set next_run_timestamp to current time to trigger immediate execution
    const now = new Date().toISOString();

    updateWorkflowMutation.mutate({
      workflowId: workflow.id,
      next_run_timestamp: now,
    }, {
      onSuccess: () => {
        success.show("Retry scheduled");
      },
    });
  };

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
  let totalCost = 0;
  const eventsWithCost = events.filter((e: any) => e.content?.usage?.cost != null);
  if (eventsWithCost.length > 0) {
    totalCost += eventsWithCost.reduce((sum: number, e: any) => sum + (e.content.usage.cost || 0), 0);
  }

  // Filter out workflow_run and workflow_run_end events (they are invisible markers for grouping)
  const visibleEvents = events.filter((event) => event.type !== "workflow_run" && event.type !== "workflow_run_end");

  // Separate gmail_api_call events from other events
  const gmailEvents = visibleEvents.filter(
    (event) => event.type === EVENT_TYPES.GMAIL_API_CALL
  );
  const nonGmailEvents = visibleEvents.filter(
    (event) => event.type !== EVENT_TYPES.GMAIL_API_CALL
  );

  // Create consolidated gmail event if there are gmail events
  let consolidatedGmailEvent = null;
  if (gmailEvents.length > 0) {
    // Extract unique methods from all gmail events
    const uniqueMethods = Array.from(
      new Set(
        gmailEvents.map((event) =>
          transformGmailMethod(
            (event.content as GmailApiCallEventPayload).method
          )
        )
      )
    );

    // Create a consolidated event
    consolidatedGmailEvent = {
      id: `gmail-consolidated-${gmailEvents[0].id}`,
      type: EVENT_TYPES.GMAIL_API_CALL,
      content: {
        ...gmailEvents[0].content,
        method: `${uniqueMethods.join(", ")}`,
      } as GmailApiCallEventPayload,
      timestamp: gmailEvents[0].timestamp,
    };
  }

  // Combine non-gmail events with consolidated gmail event
  const allVisibleEvents = [
    ...nonGmailEvents,
    ...(consolidatedGmailEvent ? [consolidatedGmailEvent] : []),
  ];

  // Determine if this run has an error (for header styling)
  const hasError = scriptRun?.error && scriptRun.error.length > 0;

  // Partition events by signal level for collapsing behavior
  // When there's an error, show all events for debugging context
  const { highSignal, lowSignal } = partitionEventsBySignal(allVisibleEvents);
  const shouldCollapseEvents = !hasError && lowSignal.length > 0;

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
          {/* Metadata: cost and success message */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {success.message && (
              <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                {success.message}
              </span>
            )}
            {totalCost > 0 && (
              <span className="flex items-center gap-1">
                <span>💵</span>
                <span>{totalCost.toFixed(2)}</span>
              </span>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
              aria-label="Workflow actions"
            >
              ···
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleRetry}
              disabled={updateWorkflowMutation.isPending || !!(workflow && workflow.status !== 'active')}
            >
              <span className="mr-2">🔄</span>
              {updateWorkflowMutation.isPending
                ? "Retrying..."
                : (workflow && workflow.status !== 'active')
                  ? "Enable to retry"
                  : "Retry"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleViewWorkflow}>
              <span className="mr-2">👁️</span>
              View workflow
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Link>

      {/* Events List - only show if there are visible events */}
      {!isEmpty && (
        <div className="p-2 space-y-1">
          {/* High-signal events are always visible */}
          {highSignal.map((event) => (
            <EventItem
              key={event.id}
              type={event.type as EventType}
              content={event.content as EventPayload}
              timestamp={event.timestamp}
              usage={(event.content as any)?.usage}
            />
          ))}

          {/* Low-signal events can be collapsed */}
          {shouldCollapseEvents && (
            <>
              <CollapsedEventSummary
                events={lowSignal}
                isExpanded={!isLowSignalCollapsed}
                onToggle={() => setIsLowSignalCollapsed(!isLowSignalCollapsed)}
              />
              {/* Show expanded low-signal events when not collapsed */}
              {!isLowSignalCollapsed &&
                lowSignal.map((event) => (
                  <EventItem
                    key={event.id}
                    type={event.type as EventType}
                    content={event.content as EventPayload}
                    timestamp={event.timestamp}
                    usage={(event.content as any)?.usage}
                  />
                ))}
            </>
          )}

          {/* When there's an error, show all low-signal events without collapse */}
          {hasError &&
            lowSignal.map((event) => (
              <EventItem
                key={event.id}
                type={event.type as EventType}
                content={event.content as EventPayload}
                timestamp={event.timestamp}
                usage={(event.content as any)?.usage}
              />
            ))}
        </div>
      )}
    </div>
  );
}
