import { TaskType } from "@app/db";
import { EvalResult } from "./sandbox/sandbox";

export type StepReason = "code" | "input"; // "start" | "timer";
export type StepOutputKind = "done" | "code" | "wait";

export type StepAttachment = {
  type: "image_url",
  image_url: {
    url: string;
  }
} | {
  type: "file",
  file: {
    filename: string;
    file_data: string;
  }
} | {
  type: "input_audio",
  input_audio: {
    data: string;
    format: string;
  }
};

export type StepInput = {
  step: number;
  reason: StepReason;
  inbox: string[];
  now: string; // ISO
  result?: EvalResult;
};

/** Patch for updating task state. Only `asks` is used now (Spec 10). */
export type TaskPatch = {
  asks?: string;
};

export type StepOutput = { steps: number; reasoning?: string } & (
  | { kind: "done"; reply: string; patch?: TaskPatch }
  | { kind: "code"; code: string; patch?: TaskPatch }
  | { kind: "wait"; reply?: string; patch?: TaskPatch }
);

export type AgentTask = {
  id: string;
  type: TaskType;
  /** Task state containing only the asks field (Spec 10) */
  asks?: string;
  chat_id: string;
};
