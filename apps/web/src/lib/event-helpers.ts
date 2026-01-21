import { EVENT_TYPES, GmailApiCallEventPayload } from "../types/events";

// Transform Gmail API method names to simpler, user-friendly names
export function transformGmailMethod(method: string): string {
  const methodMap: Record<string, string> = {
    "users.messages.list": "read messages",
    "users.messages.get": "read messages",
    "users.messages.attachments.get": "read attachments",
    "users.history.list": "read history",
    "users.threads.get": "read threads",
    "users.threads.list": "read threads",
    "users.getProfile": "read profile",
  };

  return methodMap[method] || method.split(".").pop() || method;
}

/**
 * Base event interface for Gmail consolidation and event processing.
 * Both TaskEvent and WorkflowEvent conform to this shape.
 */
export interface BaseEvent {
  id: string;
  type: string;
  content: any;
  timestamp: string;
}

/**
 * Consolidate multiple Gmail API call events into a single event.
 * Extracts unique methods and combines them into one event with a comma-separated method list.
 *
 * @param gmailEvents - Array of Gmail API call events to consolidate
 * @returns A consolidated Gmail event, or null if no events provided
 */
export function consolidateGmailEvents<T extends BaseEvent>(
  gmailEvents: T[]
): T | null {
  if (gmailEvents.length === 0) return null;

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

  // Create a consolidated event with the same type as input
  return {
    ...gmailEvents[0],
    id: `gmail-consolidated-${gmailEvents[0].id}`,
    type: EVENT_TYPES.GMAIL_API_CALL,
    content: {
      ...gmailEvents[0].content,
      method: uniqueMethods.join(", "),
    } as GmailApiCallEventPayload,
  };
}

/**
 * Process events to separate Gmail events from others and consolidate Gmail events.
 * Filters out marker events (task_run, workflow_run, etc.) and consolidates Gmail API calls.
 *
 * @param events - Raw events array
 * @param markerTypes - Event types to filter out (e.g., ["task_run", "task_run_end"])
 * @returns Array of visible events with Gmail events consolidated
 */
export function processEventsForDisplay<T extends BaseEvent>(
  events: T[],
  markerTypes: string[]
): T[] {
  // Filter out marker events
  const visibleEvents = events.filter(
    (event) => !markerTypes.includes(event.type)
  );

  // Separate gmail_api_call events from other events
  const gmailEvents = visibleEvents.filter(
    (event) => event.type === EVENT_TYPES.GMAIL_API_CALL
  );
  const nonGmailEvents = visibleEvents.filter(
    (event) => event.type !== EVENT_TYPES.GMAIL_API_CALL
  );

  // Consolidate gmail events if any exist
  const consolidatedGmail = consolidateGmailEvents(gmailEvents);

  // Combine non-gmail events with consolidated gmail event
  return [
    ...nonGmailEvents,
    ...(consolidatedGmail ? [consolidatedGmail] : []),
  ];
}

// Format duration into short rounded format (e.g., "2d", "5h", "30m", "45s")
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
