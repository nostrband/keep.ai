import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWorkflow } from "../hooks/dbScriptReads";
import { EventItem } from "./EventItem";
import {
  EventType,
  EventPayload,
  GmailApiCallEventPayload,
  EVENT_TYPES,
} from "../types/events";

// Transform Gmail API method names to simpler, user-friendly names
function transformGmailMethod(method: string): string {
  const methodMap: Record<string, string> = {
    "users.messages.list": "messages",
    "users.messages.get": "messages",
    "users.messages.attachments.get": "attachments",
    "users.history.list": "history",
    "users.threads.get": "threads",
    "users.threads.list": "threads",
    "users.getProfile": "profile",
  };

  return methodMap[method] || method.split(".").pop() || method;
}

// Helper function to format duration into short rounded format
function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

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
  const { data: workflow } = useWorkflow(workflowId);

  const handleWorkflowMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement workflow menu actions
    console.log("Workflow menu clicked for workflow:", workflowId);
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
  const finalEvents = [
    ...nonGmailEvents,
    ...(consolidatedGmailEvent ? [consolidatedGmailEvent] : []),
  ];

  // Check if this is an empty group (only workflow_run events)
  const isEmpty = finalEvents.length === 0;

  return (
    <div
      className={`mx-0 my-3 border border-gray-200 bg-gray-50 ${
        isEmpty ? "rounded-lg" : "rounded-lg"
      }`}
    >
      {/* Workflow Title Header */}
      <Link
        to={linkUrl}
        className={`flex items-center justify-between px-2 py-0 bg-gray-50 ${
          isEmpty ? "rounded-lg" : "border-b border-gray-200 rounded-t-lg"
        } hover:bg-gray-100 cursor-pointer transition-colors duration-200`}
      >
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
          onClick={handleWorkflowMenuClick}
          className="ml-2 px-2 py-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
          aria-label="Workflow actions"
        >
          ···
        </button>
      </Link>

      {/* Events List - only show if there are visible events */}
      {!isEmpty && (
        <div className="p-2 space-y-1">
          {finalEvents.map((event) => (
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
