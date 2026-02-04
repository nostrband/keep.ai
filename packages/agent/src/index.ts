// Tools and toolset
export {
  makeGetWeatherTool,
  makeCreateNoteTool,
  makeListNotesTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeSearchNotesTool,
  makeUpdateNoteTool,
  makeWebSearchTool,
  makePdfExplainTool,
  makeAudioExplainTool,
  makeAtobTool,
  makeConsoleLogTool,
  // makeItemsListTool removed (exec-02 - deprecated Items infrastructure)
  // Topics API (exec-03)
  makeTopicsPeekTool,
  makeTopicsGetByIdsTool,
  makeTopicsPublishTool,
  // Tool definition helpers
  defineTool,
  defineReadOnlyTool,
} from "./tools";
export type { Tool, ReadOnlyTool } from "./tools";

// AI tools (planner/maintainer specific)
export {
  makeAskTool,
  makeEvalTool,
  makeFinishTool,
  makeFixTool,
  makeSaveTool,
  makeScheduleTool,
  type AskInfo,
  type FinishInfo,
  type FixInfo,
  type FixResult,
  type SaveInfo,
  type SaveResult,
  type ScheduleInfo,
} from "./ai-tools";

// Environment configuration
export { setEnv, getEnv, setEnvFromProcess, type Env } from "./env";

// Model configuration
export { getOpenRouter, getModelName, DEFAULT_AGENT_MODEL } from "./model";

export { Agent as ReplAgent } from "./agent";

export {
  type AgentTask as Task,
  type StepInput,
  type StepOutput,
  type TaskPatch,
} from "./agent-types";

export {
  TaskWorker,
  type TaskWorkerConfig as ReplWorkerConfig,
} from "./task-worker";

export {
  TaskScheduler,
  type TaskSchedulerConfig,
  selectTaskByPriority,
  type TaskPriorityOptions,
} from "./task-scheduler";

export {
  type TaskExecutionSignal,
  type TaskSignalHandler,
  type TaskRetryState,
} from "./task-worker-signal";

// Workflow scheduling
export {
  WorkflowScheduler,
  type WorkflowSchedulerConfig,
} from "./workflow-scheduler";

export {
  WorkflowWorker,
  type WorkflowWorkerConfig,
  MAX_FIX_ATTEMPTS,
  escalateToUser,
  type EscalateToUserOptions,
  type EscalateToUserResult,
} from "./workflow-worker";

export {
  type WorkflowExecutionSignal,
  type WorkflowSignalHandler,
  type WorkflowRetryState,
} from "./workflow-worker-signal";

export { initSandbox } from "./sandbox/sandbox";

// Sandbox tool management (exec-03a)
export { ToolWrapper, type ToolWrapperConfig, type ExecutionPhase, type OperationType } from "./sandbox/tool-wrapper";
export { createWorkflowTools, createTaskTools, type ToolListConfig } from "./sandbox/tool-lists";

// Workflow validation (exec-05)
export { validateWorkflowScript, isWorkflowFormatScript, type WorkflowConfig, type ValidationResult } from "./workflow-validator";

// Handler state machine (exec-06)
export {
  executeHandler,
  isTerminal,
  type HandlerResult,
  type PrepareResult,
  type HandlerExecutionContext,
} from "./handler-state-machine";

// Session orchestration (exec-07)
export {
  executeWorkflowSession,
  executeWorkflowSessionIfIdle,
  resumeIncompleteSessions,
  canStartSession,
  getSessionCost,
  type SessionTrigger,
  type SessionResult,
  type SessionConfig,
} from "./session-orchestration";

/** @deprecated Use ToolWrapper from './sandbox/tool-wrapper' instead */
export { SandboxAPI } from "./sandbox/api";

export { AgentEnv as ReplEnv } from "./agent-env";

// Error classification system
export {
  ClassifiedError,
  AuthError,
  PermissionError,
  NetworkError,
  LogicError,
  WorkflowPausedError,
  isClassifiedError,
  isErrorType,
  isWorkflowPausedError,
  classifyHttpError,
  classifyFileError,
  classifyGenericError,
  classifyGoogleApiError,
  ensureClassified,
  formatUsageForEvent,
  type ErrorType,
  type EventUsageData,
} from "./errors";

export type {
  Sandbox,
  SandboxOptions,
  EvalOptions,
  EvalResult,
  EvalContext,
} from "./sandbox/sandbox";
