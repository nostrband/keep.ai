// Own message types (replaces ai SDK types)
export interface TextUIPart {
  type: "text";
  text: string;
}

export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
}

export interface FileUIPart {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
}

export interface ToolUIPart {
  type: string;
  toolCallId: string;
  state: "partial-call" | "call" | "result";
  input: any;
  output?: any;
  errorText?: string;
}

export interface StepStartUIPart {
  type: "step-start";
}

export interface SourceUrlUIPart {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
}

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | ToolUIPart
  | StepStartUIPart
  | SourceUrlUIPart;

export interface UIMessage<METADATA = any> {
  id: string;
  role: "user" | "assistant" | "system";
  parts: UIMessagePart[];
  metadata?: METADATA;
}

export interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface GeneratedImage {
  base64: string;
  mediaType: string;
}

export type AutonomyMode = 'ai_decides' | 'coordinate';

export interface MessageMetadata {
  createdAt: string;
  threadId?: string;
  volatile?: boolean;
}

export type AssistantUIMessage = UIMessage<MessageMetadata>;

export interface ChatAgentEvent {
  task_id: string;
  task_run_id: string;
  [key: string]: any;
}

export interface ChatEvent {
  id: string;
  type: string;
  content: AssistantUIMessage | ChatAgentEvent;
  timestamp: string;
}
