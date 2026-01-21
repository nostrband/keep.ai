// Event type constants
export const EVENT_TYPES = {
  CREATE_NOTE: "create_note",
  UPDATE_NOTE: "update_note",
  DELETE_NOTE: "delete_note",
  ADD_TASK: "add_task",
  ADD_TASK_CRON: "add_task_cron",
  CANCEL_THIS_TASK_CRON: "cancel_this_task_cron",
  SEND_TO_TASK_INBOX: "send_to_task_inbox",
  TASK_UPDATE: "task_update",
  WEB_SEARCH: "web_search",
  WEB_FETCH: "web_fetch",
  GET_WEATHER: "get_weather",
  IMAGES_GENERATE: "images_generate",
  IMAGES_EXPLAIN: "images_explain",
  IMAGES_TRANSFORM: "images_transform",
  PDF_EXPLAIN: "pdf_explain",
  AUDIO_EXPLAIN: "audio_explain",
  TASK_RUN: "task_run",
  TASK_RUN_END: "task_run_end",
  GMAIL_API_CALL: "gmail_api_call",
  WEB_DOWNLOAD: "web_download",
  FILE_SAVE: "file_save",
  ADD_SCRIPT: "add_script",
  TEXT_EXTRACT: "text_extract",
  TEXT_CLASSIFY: "text_classify",
  TEXT_SUMMARIZE: "text_summarize",
  TEXT_GENERATE: "text_generate",
  MAINTENANCE_STARTED: "maintenance_started",
  MAINTENANCE_ESCALATED: "maintenance_escalated",
  MAINTENANCE_FIXED: "maintenance_fixed",
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
}

export interface CancelThisTaskCronEventPayload extends BaseEventPayload {
  // No additional fields
}

export interface SendToTaskInboxEventPayload extends BaseEventPayload {
  target_task_id: string;
  target_task_title: string;
}

export interface TaskUpdateEventPayload extends BaseEventPayload {
  task_id: string;
  title: string;
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

export interface ImagesExplainEventPayload extends BaseEventPayload {
  file: string;
  question: string;
  explanation: string;
}

export interface ImagesTransformEventPayload extends BaseEventPayload {
  source_file?: string; // Deprecated: single source file (for backward compatibility)
  source_files?: string[]; // New: array of source files
  prompt: string;
  aspect_ratio: string;
  count: number;
  files: string[];
}

export interface PdfExplainEventPayload extends BaseEventPayload {
  file: string;
  prompt: string;
  explanation: string;
}

export interface AudioExplainEventPayload extends BaseEventPayload {
  file: string;
  prompt: string;
  explanation: string;
}

export interface TaskRunEventPayload extends BaseEventPayload {
  // task_run events are invisible markers for grouping
}

export interface TaskRunEndEventPayload extends BaseEventPayload {
  // task_run_end events are invisible markers for grouping
  usage?: {
    cost?: number;
  };
}

export interface TextExtractEventPayload extends BaseEventPayload {
  output: any;
  inputLength: number;
}

export interface TextClassifyEventPayload extends BaseEventPayload {
  textLength: number;
  classCount: number;
  selectedClass: string;
  usage?: {
    cost?: number;
  };
}

export interface TextSummarizeEventPayload extends BaseEventPayload {
  inputLength: number;
  summaryLength: number;
  maxChars: number;
  usage?: {
    cost?: number;
  };
}

export interface TextGenerateEventPayload extends BaseEventPayload {
  promptLength: number;
  generatedLength: number;
  temperature: number;
  maxChars: number;
  usage?: {
    cost?: number;
  };
}

export interface GmailApiCallEventPayload extends BaseEventPayload {
  method: string;
  params: any;
}

export interface WebDownloadEventPayload extends BaseEventPayload {
  url: string;
  filename: string;
  size: number;
}

export interface FileSaveEventPayload extends BaseEventPayload {
  filename: string;
  size: number;
  mimeType?: string;
}

export interface AddScriptEventPayload extends BaseEventPayload {
  script_id: string;
  version: number;
}

// Maintenance event payloads - used when workflows enter/exit maintenance mode
export interface MaintenanceStartedEventPayload extends BaseEventPayload {
  workflow_id: string;
  script_run_id: string;
  error_type: string;
  error_message: string;
}

export interface MaintenanceEscalatedEventPayload extends BaseEventPayload {
  workflow_id: string;
  script_run_id: string;
  error_type: string;
  error_message: string;
  fix_attempts: number;
  max_fix_attempts: number;
}

export interface MaintenanceFixedEventPayload extends BaseEventPayload {
  workflow_id: string;
  script_id: string;
  fix_comment: string;
  version: number;
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
  | TaskUpdateEventPayload
  | WebSearchEventPayload
  | WebFetchEventPayload
  | GetWeatherEventPayload
  | ImagesGenerateEventPayload
  | ImagesExplainEventPayload
  | ImagesTransformEventPayload
  | PdfExplainEventPayload
  | AudioExplainEventPayload
  | TaskRunEventPayload
  | TaskRunEndEventPayload
  | TextExtractEventPayload
  | TextClassifyEventPayload
  | TextSummarizeEventPayload
  | TextGenerateEventPayload
  | GmailApiCallEventPayload
  | WebDownloadEventPayload
  | FileSaveEventPayload
  | AddScriptEventPayload
  | MaintenanceStartedEventPayload
  | MaintenanceEscalatedEventPayload
  | MaintenanceFixedEventPayload;

// Event interface that matches the database structure
export interface ChatEvent {
  id: string;
  type: EventType;
  content: EventPayload;
  timestamp: string;
  // Add other fields that might exist based on your database schema
}

// Event significance levels for visual highlighting
export type EventSignificance =
  | 'normal'    // Routine operations (reads, analysis)
  | 'write'     // Write/create actions (notes, files, tasks)
  | 'error'     // Failures (reserved for future use)
  | 'success'   // Fixes, resolutions (reserved for future use)
  | 'user'      // User interactions (reserved for future use)
  | 'state';    // State changes (reserved for future use)

// Event display configuration
export interface EventConfig {
  emoji: string;
  title: (payload: EventPayload) => string;
  hasId: boolean; // Whether this event type has an 'id' field for navigation
  getEntityPath?: (payload: EventPayload) => string; // Path for navigation if hasId is true
  significance: EventSignificance; // Visual significance level for highlighting
}

export const EVENT_CONFIGS: Record<EventType, EventConfig> = {
  [EVENT_TYPES.CREATE_NOTE]: {
    emoji: "📝",
    title: (payload) =>
      `New Note: ${(payload as CreateNoteEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/notes/${(payload as CreateNoteEventPayload).id}`,
    significance: 'write',
  },
  [EVENT_TYPES.UPDATE_NOTE]: {
    emoji: "✏️",
    title: (payload) =>
      `Updated Note: ${(payload as UpdateNoteEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/notes/${(payload as UpdateNoteEventPayload).id}`,
    significance: 'write',
  },
  [EVENT_TYPES.DELETE_NOTE]: {
    emoji: "🗑️",
    title: (payload) =>
      `Deleted Note: ${(payload as DeleteNoteEventPayload).title}`,
    hasId: false, // Can't navigate to deleted note
    significance: 'write',
  },
  [EVENT_TYPES.ADD_TASK]: {
    emoji: "➕",
    title: (payload) => `New Task: ${(payload as AddTaskEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) => `/tasks/${(payload as AddTaskEventPayload).id}`,
    significance: 'write',
  },
  [EVENT_TYPES.ADD_TASK_CRON]: {
    emoji: "🔄",
    title: (payload) =>
      `New Recurring Task: ${(payload as AddTaskCronEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/tasks/${(payload as AddTaskCronEventPayload).id}`,
    significance: 'write',
  },
  [EVENT_TYPES.CANCEL_THIS_TASK_CRON]: {
    emoji: "❌",
    title: () => "Cancelled Recurring Task",
    hasId: false,
    significance: 'state',
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
    significance: 'write',
  },
  [EVENT_TYPES.TASK_UPDATE]: {
    emoji: "✏️",
    title: (payload) =>
      `Updated Task Title: ${(payload as TaskUpdateEventPayload).title}`,
    hasId: true,
    getEntityPath: (payload) =>
      `/tasks/${(payload as TaskUpdateEventPayload).task_id}`,
    significance: 'write',
  },
  [EVENT_TYPES.WEB_SEARCH]: {
    emoji: "🔍",
    title: (payload) =>
      `Web Search: ${(payload as WebSearchEventPayload).query}`,
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.WEB_FETCH]: {
    emoji: "🌐",
    title: (payload) => `Fetched: ${(payload as WebFetchEventPayload).url}`,
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.GET_WEATHER]: {
    emoji: "🌤️",
    title: (payload) => `Weather: ${(payload as GetWeatherEventPayload).place}`,
    hasId: false,
    significance: 'normal',
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
    significance: 'write',
  },
  [EVENT_TYPES.IMAGES_EXPLAIN]: {
    emoji: "🔍",
    title: (payload) => {
      const explainPayload = payload as ImagesExplainEventPayload;
      return `Analyzed image: ${explainPayload.file}`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.IMAGES_TRANSFORM]: {
    emoji: "🖼️",
    title: (payload) => {
      const transformPayload = payload as ImagesTransformEventPayload;
      const imageCount = transformPayload.count || transformPayload.files?.length || 1;

      // Support both new source_files (array) and old source_file (string) for backward compatibility
      let sourceText: string;
      if (transformPayload.source_files && transformPayload.source_files.length > 0) {
        const sourceCount = transformPayload.source_files.length;
        sourceText = sourceCount === 1
          ? transformPayload.source_files[0]
          : `${sourceCount} images`;
      } else if (transformPayload.source_file) {
        // Backward compatibility with old format
        sourceText = transformPayload.source_file;
      } else {
        sourceText = "image";
      }

      return `Transformed ${sourceText} → ${imageCount} image${imageCount > 1 ? "s" : ""}`;
    },
    hasId: false,
    significance: 'write',
  },
  [EVENT_TYPES.PDF_EXPLAIN]: {
    emoji: "📄",
    title: (payload) => {
      const pdfPayload = payload as PdfExplainEventPayload;
      return `Analyzed PDF: ${pdfPayload.file}`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.AUDIO_EXPLAIN]: {
    emoji: "🎵",
    title: (payload) => {
      const audioPayload = payload as AudioExplainEventPayload;
      return `Analyzed audio: ${audioPayload.file}`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TASK_RUN]: {
    emoji: "⚙️",
    title: () => "Task Run",
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TASK_RUN_END]: {
    emoji: "✅",
    title: () => "Task Run End",
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TEXT_EXTRACT]: {
    emoji: "📝",
    title: (payload) => {
      const extractPayload = payload as TextExtractEventPayload;
      return `Extracted data of ${JSON.stringify(extractPayload?.output || {}).length} chars from ${extractPayload?.inputLength || 0} chars text`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TEXT_CLASSIFY]: {
    emoji: "🏷️",
    title: (payload) => {
      const classifyPayload = payload as TextClassifyEventPayload;
      return `Classified ${classifyPayload.textLength} chars text → ${classifyPayload.selectedClass}`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TEXT_SUMMARIZE]: {
    emoji: "📋",
    title: (payload) => {
      const summarizePayload = payload as TextSummarizeEventPayload;
      return `Summarized ${summarizePayload.inputLength} chars → ${summarizePayload.summaryLength} chars`;
    },
    hasId: false,
    significance: 'normal',
  },
  [EVENT_TYPES.TEXT_GENERATE]: {
    emoji: "✍️",
    title: (payload) => {
      const generatePayload = payload as TextGenerateEventPayload;
      return `Generated ${generatePayload.generatedLength} chars text (temp: ${generatePayload.temperature})`;
    },
    hasId: false,
    significance: 'write',
  },
  [EVENT_TYPES.GMAIL_API_CALL]: {
    emoji: "📧",
    title: (payload) => {
      const gmailPayload = payload as GmailApiCallEventPayload;
      return `Gmail: ${gmailPayload.method}`;
    },
    hasId: false,
    // Gmail significance is determined dynamically based on read vs write methods
    significance: 'normal',
  },
  [EVENT_TYPES.WEB_DOWNLOAD]: {
    emoji: "💾",
    title: (payload) => {
      const downloadPayload = payload as WebDownloadEventPayload;
      const fileSizeKB = Math.round(downloadPayload.size / 1024);
      return `Downloaded: ${downloadPayload.filename} (${fileSizeKB}KB)`;
    },
    hasId: false,
    significance: 'write',
  },
  [EVENT_TYPES.FILE_SAVE]: {
    emoji: "📁",
    title: (payload) => {
      const savePayload = payload as FileSaveEventPayload;
      const fileSizeKB = Math.round(savePayload.size / 1024);
      return `Saved: ${savePayload.filename} (${fileSizeKB}KB)`;
    },
    hasId: false,
    significance: 'write',
  },
  [EVENT_TYPES.ADD_SCRIPT]: {
    emoji: "📜",
    title: (payload) => {
      const scriptPayload = payload as AddScriptEventPayload;
      return scriptPayload.version === 1 ? "Create script" : "Update script";
    },
    hasId: true,
    getEntityPath: (payload) =>
      `/scripts/${(payload as AddScriptEventPayload).script_id}`,
    significance: 'write',
  },
  [EVENT_TYPES.MAINTENANCE_STARTED]: {
    emoji: "🔧",
    title: (payload) => {
      const maintenancePayload = payload as MaintenanceStartedEventPayload;
      return `Maintenance started: ${maintenancePayload.error_type}`;
    },
    hasId: true,
    getEntityPath: (payload) =>
      `/automations/${(payload as MaintenanceStartedEventPayload).workflow_id}`,
    significance: 'state',
  },
  [EVENT_TYPES.MAINTENANCE_ESCALATED]: {
    emoji: "⚠️",
    title: (payload) => {
      const escalatedPayload = payload as MaintenanceEscalatedEventPayload;
      return `Maintenance escalated after ${escalatedPayload.fix_attempts} attempts`;
    },
    hasId: true,
    getEntityPath: (payload) =>
      `/automations/${(payload as MaintenanceEscalatedEventPayload).workflow_id}`,
    significance: 'error',
  },
  [EVENT_TYPES.MAINTENANCE_FIXED]: {
    emoji: "✅",
    title: (payload) => {
      const fixedPayload = payload as MaintenanceFixedEventPayload;
      return `Maintenance fixed: ${fixedPayload.fix_comment}`;
    },
    hasId: true,
    getEntityPath: (payload) =>
      `/automations/${(payload as MaintenanceFixedEventPayload).workflow_id}`,
    significance: 'success',
  },
};

// Gmail methods that write/modify data (for dynamic significance detection)
export const GMAIL_WRITE_METHODS = [
  'users.messages.send',
  'users.messages.modify',
  'users.messages.trash',
  'users.messages.untrash',
  'users.messages.delete',
  'users.drafts.create',
  'users.drafts.send',
  'users.drafts.update',
  'users.drafts.delete',
  'users.labels.create',
  'users.labels.update',
  'users.labels.delete',
];

// Get the effective significance of an event, handling dynamic cases like Gmail
export function getEventSignificance(
  type: EventType,
  payload: EventPayload
): EventSignificance {
  const config = EVENT_CONFIGS[type];
  if (!config) return 'normal';

  // Gmail API calls depend on the method
  if (type === EVENT_TYPES.GMAIL_API_CALL) {
    const gmailPayload = payload as GmailApiCallEventPayload;
    const isWriteMethod = GMAIL_WRITE_METHODS.some(
      method => gmailPayload.method?.includes(method)
    );
    return isWriteMethod ? 'write' : 'normal';
  }

  return config.significance;
}
