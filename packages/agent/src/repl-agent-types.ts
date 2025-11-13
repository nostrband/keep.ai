export type TaskType = "router" | "worker" | "replier";
export type StepReason = "start" | "code" | "input" | "timer";
export type StepOutputKind = "done" | "code" | "wait";

export type TaskState = {
  goal?: string;
  notes?: string;
  plan?: string;
  asks?: string;
  resumeAt?: string;
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
  | { kind: "wait"; patch: TaskState }
);

export type Task = {
  type: TaskType;
  state?: TaskState;
};
