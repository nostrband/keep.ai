export type TaskType = "router" | "worker" | "replier";
export type StepReason = "start" | "code" | "input" | "timer";
export type StepOutputKind = "done" | "code" | "wait";

export type TaskState = {
  goal?: string;
  notes?: string;
  plan?: string;
  asks?: string;
};

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
  result?: {
    ok: boolean;
    result?: any;
    error?: string;
  };
};

export type StepOutput = { steps: number; reasoning?: string } & (
  | { kind: "done"; reply: string; patch?: TaskState }
  | { kind: "code"; code: string; patch?: TaskState }
  | { kind: "wait"; reply?: string; resumeAt?: string; patch?: TaskState }
);

export type AgentTask = {
  id: string;
  type: TaskType;
  state?: TaskState;
};
