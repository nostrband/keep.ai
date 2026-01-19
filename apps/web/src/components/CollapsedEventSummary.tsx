import React from "react";
import { getEventTypeLabel } from "../lib/eventSignal";

interface CollapsedEvent {
  type: string;
  content: { usage?: { cost?: number } };
}

interface CollapsedEventSummaryProps {
  events: CollapsedEvent[];
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * A collapsible summary row for low-signal events.
 * Shows a count and unique event types when collapsed,
 * with an expand/collapse toggle.
 */
export function CollapsedEventSummary({
  events,
  isExpanded,
  onToggle,
}: CollapsedEventSummaryProps) {
  // Get unique event types for summary display
  const uniqueTypes = Array.from(new Set(events.map((e) => e.type)));
  const typeLabels = uniqueTypes.slice(0, 3).map(getEventTypeLabel);

  // Calculate total cost of collapsed events
  const totalCost = events.reduce(
    (sum, e) => sum + (e.content?.usage?.cost || 0),
    0
  );

  const eventCount = events.length;
  const chevron = isExpanded ? "▼" : "▶";
  const action = isExpanded ? "Hide" : "Show";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="
        flex items-center justify-between w-full px-2 py-1 my-1
        text-sm text-gray-500 cursor-pointer
        hover:bg-gray-100 rounded-full transition-colors
        border border-gray-100 bg-gray-50
      "
      aria-expanded={isExpanded}
      aria-label={`${action} ${eventCount} routine events`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-gray-400 flex-shrink-0">{chevron}</span>
        <span className="truncate">
          {eventCount} routine event{eventCount > 1 ? "s" : ""}
          <span className="text-gray-400 ml-1">
            ({typeLabels.join(", ")}
            {uniqueTypes.length > 3 ? ", ..." : ""})
          </span>
        </span>
        {/* Show aggregate cost if any events have cost */}
        {totalCost > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
            <span>💵</span>
            <span>{totalCost.toFixed(2)}</span>
          </span>
        )}
      </span>
      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{action}</span>
    </button>
  );
}
