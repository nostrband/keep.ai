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

/**
 * Context for maintainer tasks, provided when task.type === "maintainer".
 * Contains information needed for the fix tool's race condition check
 * and the maintainer agent's diagnostic context.
 */
export interface MaintainerContext {
  /** Workflow being maintained */
  workflowId: string;
  /** Major version when maintainer started - used for race condition detection */
  expectedMajorVersion: number;
  /** The failed script run ID for tracking */
  scriptRunId: string;
  /** Error details from the failed run */
  error: {
    type: string;
    message: string;
  };
  /** Console output from the failed run (last 50 lines) */
  logs: string;
  /** The script code that failed */
  scriptCode: string;
  /** Formatted version string (e.g., "2.1") */
  scriptVersion: string;
  /** Changelog of prior minor versions for this major version */
  changelog: Array<{ version: string; comment: string }>;
}

export type AgentTask = {
  id: string;
  type: TaskType;
  /** Task state containing only the asks field (Spec 10) */
  asks?: string;
  chat_id: string;
  /** Maintainer-specific context (only present when type === "maintainer") */
  maintainerContext?: MaintainerContext;
};
