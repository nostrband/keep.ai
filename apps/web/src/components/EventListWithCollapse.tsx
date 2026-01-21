import React, { useState } from "react";
import { EventItem } from "./EventItem";
import { CollapsedEventSummary } from "./CollapsedEventSummary";
import { EventType, EventPayload } from "../types/events";
import { partitionEventsBySignal } from "../lib/eventSignal";

/**
 * Base event interface matching both TaskEvent and WorkflowEvent shapes.
 */
interface BaseEvent {
  id: string;
  type: string;
  content: any;
  timestamp: string;
}

interface EventListWithCollapseProps {
  /**
   * Array of events to display
   */
  events: BaseEvent[];
  /**
   * Whether the run has an error - if true, all events are shown for debugging context
   */
  hasError: boolean;
}

/**
 * Shared component for rendering a list of events with collapse/expand behavior.
 *
 * This component is used by both TaskEventGroup and WorkflowEventGroup to:
 * - Partition events into high-signal (always visible) and low-signal (collapsible) groups
 * - Show all events when there's an error for debugging context
 * - Provide consistent collapse/expand UI for low-signal events
 *
 * @example
 * ```tsx
 * <EventListWithCollapse events={allVisibleEvents} hasError={hasError} />
 * ```
 */
export function EventListWithCollapse({
  events,
  hasError,
}: EventListWithCollapseProps) {
  const [isLowSignalCollapsed, setIsLowSignalCollapsed] = useState(true);

  // Partition events by signal level for collapsing behavior
  // When there's an error, show all events for debugging context
  const { highSignal, lowSignal } = partitionEventsBySignal(events);
  const shouldCollapseEvents = !hasError && lowSignal.length > 0;

  // Don't render anything if no events
  if (events.length === 0) {
    return null;
  }

  return (
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
  );
}
