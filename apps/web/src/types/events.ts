// Event type constants
export const EVENT_TYPES = {
  CREATE_NOTE: "create_note",
  UPDATE_NOTE: "update_note",
  DELETE_NOTE: "delete_note",
  ADD_TASK: "add_task",
  ADD_TASK_CRON: "add_task_cron",
  CANCEL_THIS_TASK_CRON: "cancel_this_task_cron",
  SEND_TO_TASK_INBOX: "send_to_task_inbox",
  WEB_SEARCH: "web_search",
  WEB_FETCH: "web_fetch",
  GET_WEATHER: "get_weather",
  IMAGES_GENERATE: "images_generate",
  TASK_RUN: "task_run",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Base interface for all events (createEvent automatically adds task_id and task_run_id)
export interface BaseEventPayload {
  task_id: string;
  task_run_id: string;
}

// Specific payload interfaces for each event type
export interface CreateNoteEventPayload extends BaseEventPayload {
  id: string;
  title: string;
}

export interface UpdateNoteEventPayload extends BaseEventPayload {
  id: string;
  title: string;
}

export interface DeleteNoteEventPayload extends BaseEventPayload {
  id: string;
  title: string;
}

export interface AddTaskEventPayload extends BaseEventPayload {
  id: string;
  title: string;
  startAt?: string;
}

export interface AddTaskCronEventPayload extends BaseEventPayload {
  id: string;
  title: string;
  cron: string;
}

export interface CancelThisTaskCronEventPayload extends BaseEventPayload {
  // No additional fields
}

export interface SendToTaskInboxEventPayload extends BaseEventPayload {
  target_task_id: string;
  target_task_title: string;
}

export interface WebSearchEventPayload extends BaseEventPayload {
  query: string;
}

export interface WebFetchEventPayload extends BaseEventPayload {
  url: string;
}

export interface GetWeatherEventPayload extends BaseEventPayload {
  place: string;
  days: number;
}

export interface ImagesGenerateEventPayload extends BaseEventPayload {
  prompt: string;
  aspect_ratio: string;
  count: number;
  files: string[];
}

export interface TaskRunEventPayload extends BaseEventPayload {
  // task_run events are invisible markers for grouping
}

// Union type for all event payloads
export type EventPayload =
  | CreateNoteEventPayload
  | UpdateNoteEventPayload
  | DeleteNoteEventPayload
  | AddTaskEventPayload
  | AddTaskCronEventPayload
  | CancelThisTaskCronEventPayload
  | SendToTaskInboxEventPayload
  | WebSearchEventPayload
  | WebFetchEventPayload
  | GetWeatherEventPayload
  | ImagesGenerateEventPayload
  | TaskRunEventPayload;

// Event interface that matches the database structure
export interface ChatEvent {
  id: string;
  type: EventType;
  content: EventPayload;
  timestamp: string;
  // Add other fields that might exist based on your database schema
}

// Event display configuration
export interface EventConfig {
  emoji: string;
  title: (payload: EventPayload) => string;
  hasId: boolean; // Whether this event type has an 'id' field for navigation
  getEntityPath?: (payload: EventPayload) => string; // Path for navigation if hasId is true
}

export const EVENT_CONFIGS: Record<EventType, EventConfig> = {
  [EVENT_TYPES.CREATE_NOTE]: {
    emoji: "📝",
    title: (payload) =>
      `New Note: ${(payload as CreateNoteEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/notes/${(payload as CreateNoteEventPayload).id}`,
  },
  [EVENT_TYPES.UPDATE_NOTE]: {
    emoji: "✏️",
    title: (payload) =>
      `Updated Note: ${(payload as UpdateNoteEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/notes/${(payload as UpdateNoteEventPayload).id}`,
  },
  [EVENT_TYPES.DELETE_NOTE]: {
    emoji: "🗑️",
    title: (payload) =>
      `Deleted Note: ${(payload as DeleteNoteEventPayload).title}`,
    hasId: false, // Can't navigate to deleted note
  },
  [EVENT_TYPES.ADD_TASK]: {
    emoji: "➕",
    title: (payload) => `New Task: ${(payload as AddTaskEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) => `/tasks/${(payload as AddTaskEventPayload).id}`,
  },
  [EVENT_TYPES.ADD_TASK_CRON]: {
    emoji: "🔄",
    title: (payload) =>
      `New Recurring Task: ${(payload as AddTaskCronEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/tasks/${(payload as AddTaskCronEventPayload).id}`,
  },
  [EVENT_TYPES.CANCEL_THIS_TASK_CRON]: {
    emoji: "❌",
    title: () => "Cancelled Recurring Task",
    hasId: false,
  },
  [EVENT_TYPES.SEND_TO_TASK_INBOX]: {
    emoji: "📬",
    title: (payload) =>
      `Sent to Task: ${
        (payload as SendToTaskInboxEventPayload).target_task_title ||
        // deprecated
        (payload as any).task_title
      }`,
    hasId: true,
    getEntityPath: (payload) =>
      `/tasks/${
        (payload as SendToTaskInboxEventPayload).target_task_id ||
        // deprecated
        (payload as any).id
      }`,
  },
  [EVENT_TYPES.WEB_SEARCH]: {
    emoji: "🔍",
    title: (payload) =>
      `Web Search: ${(payload as WebSearchEventPayload).query}`,
    hasId: false,
  },
  [EVENT_TYPES.WEB_FETCH]: {
    emoji: "🌐",
    title: (payload) => `Fetched: ${(payload as WebFetchEventPayload).url}`,
    hasId: false,
  },
  [EVENT_TYPES.GET_WEATHER]: {
    emoji: "🌤️",
    title: (payload) => `Weather: ${(payload as GetWeatherEventPayload).place}`,
    hasId: false,
  },
  [EVENT_TYPES.IMAGES_GENERATE]: {
    emoji: "🎨",
    title: (payload) => {
      const imgPayload = payload as ImagesGenerateEventPayload;
      const imageCount = imgPayload.count || imgPayload.files?.length || 1;
      return `Generated ${imageCount} image${imageCount > 1 ? "s" : ""}: ${
        imgPayload.prompt
      }`;
    },
    hasId: false,
  },
  [EVENT_TYPES.TASK_RUN]: {
    emoji: "⚙️",
    title: () => "Task Run",
    hasId: false,
  },
};
