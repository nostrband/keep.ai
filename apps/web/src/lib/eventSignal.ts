/**
 * Event signal classification for collapsible event groups.
 *
 * SignalLevel determines whether an event should be collapsed by default:
 * - 'high': Always visible - user outcomes, side effects, failures
 * - 'low': Collapsible - routine reads, analysis, intermediate processing
 *
 * This is separate from EventSignificance (used for visual styling).
 */

import {
  EVENT_TYPES,
  EventType,
  EventPayload,
  GmailApiCallEventPayload,
  GMAIL_WRITE_METHODS,
} from "../types/events";

export type SignalLevel = "high" | "low";

/**
 * Low-signal events that can be collapsed by default.
 * These represent routine read operations or internal processing
 * that usually succeed and don't need immediate attention.
 */
const LOW_SIGNAL_EVENTS: EventType[] = [
  EVENT_TYPES.WEB_FETCH, // Reading web pages is routine
  EVENT_TYPES.WEB_SEARCH, // Search queries are intermediate steps
  EVENT_TYPES.GET_WEATHER, // Simple data lookup
  EVENT_TYPES.TEXT_EXTRACT, // Internal processing step
  EVENT_TYPES.TEXT_CLASSIFY, // Internal processing step
  EVENT_TYPES.TEXT_SUMMARIZE, // Internal processing step
  EVENT_TYPES.IMAGES_EXPLAIN, // Analysis without side effects
  EVENT_TYPES.PDF_EXPLAIN, // Analysis without side effects
  EVENT_TYPES.AUDIO_EXPLAIN, // Analysis without side effects
  // Note: GMAIL_API_CALL is handled dynamically based on read vs write methods
];

/**
 * Classify an event's signal level for collapse/expand behavior.
 *
 * @param type - The event type
 * @param payload - The event payload (used for dynamic classification like Gmail)
 * @returns 'high' if event should always be visible, 'low' if collapsible
 */
export function getEventSignalLevel(
  type: EventType,
  payload: EventPayload
): SignalLevel {
  // Gmail API calls depend on the method - read is low-signal, write is high-signal
  if (type === EVENT_TYPES.GMAIL_API_CALL) {
    const gmailPayload = payload as GmailApiCallEventPayload;
    const isWriteMethod = GMAIL_WRITE_METHODS.some((method) =>
      gmailPayload.method?.includes(method)
    );
    return isWriteMethod ? "high" : "low";
  }

  // Check if in low-signal list
  if (LOW_SIGNAL_EVENTS.includes(type)) {
    return "low";
  }

  // Default to high signal (always visible)
  // This includes: CREATE_NOTE, UPDATE_NOTE, DELETE_NOTE, ADD_TASK, ADD_TASK_CRON,
  // CANCEL_THIS_TASK_CRON, SEND_TO_TASK_INBOX, TASK_UPDATE, IMAGES_GENERATE,
  // IMAGES_TRANSFORM, WEB_DOWNLOAD, FILE_SAVE, ADD_SCRIPT, TEXT_GENERATE
  return "high";
}

/**
 * Check if any event in a group has an error.
 * When errors are present, all events should be expanded for debugging context.
 *
 * @param events - Array of events to check
 * @returns true if any event has an error field
 */
export function hasErrorInGroup(
  events: Array<{ content: { error?: string } }>
): boolean {
  return events.some((e) => e.content?.error);
}

/**
 * Get a human-readable label for an event type, for use in collapsed summaries.
 * Returns short, lowercase labels like "web search", "Gmail read", etc.
 *
 * @param type - The event type
 * @returns A short human-readable label
 */
export function getEventTypeLabel(type: string): string {
  switch (type) {
    case EVENT_TYPES.WEB_FETCH:
      return "web fetch";
    case EVENT_TYPES.WEB_SEARCH:
      return "web search";
    case EVENT_TYPES.GET_WEATHER:
      return "weather";
    case EVENT_TYPES.TEXT_EXTRACT:
      return "text extract";
    case EVENT_TYPES.TEXT_CLASSIFY:
      return "text classify";
    case EVENT_TYPES.TEXT_SUMMARIZE:
      return "summarize";
    case EVENT_TYPES.IMAGES_EXPLAIN:
      return "image analysis";
    case EVENT_TYPES.PDF_EXPLAIN:
      return "PDF analysis";
    case EVENT_TYPES.AUDIO_EXPLAIN:
      return "audio analysis";
    case EVENT_TYPES.GMAIL_API_CALL:
      return "Gmail read";
    default:
      // Fallback: convert snake_case to readable format
      return type.replace(/_/g, " ");
  }
}

/**
 * Partition events into high-signal and low-signal groups.
 *
 * @param events - Array of events to partition
 * @returns Object with highSignal and lowSignal arrays
 */
export function partitionEventsBySignal<
  T extends { type: string; content: any }
>(events: T[]): { highSignal: T[]; lowSignal: T[] } {
  const highSignal: T[] = [];
  const lowSignal: T[] = [];

  for (const event of events) {
    const signalLevel = getEventSignalLevel(
      event.type as EventType,
      event.content
    );
    if (signalLevel === "high") {
      highSignal.push(event);
    } else {
      lowSignal.push(event);
    }
  }

  return { highSignal, lowSignal };
}

/**
 * Calculate the total cost of events that have usage.cost.
 *
 * @param events - Array of events with potential cost data
 * @returns Total cost in dollars
 */
export function calculateEventsCost(
  events: Array<{ content: { usage?: { cost?: number } } }>
): number {
  return events.reduce((sum, e) => sum + (e.content?.usage?.cost || 0), 0);
}
