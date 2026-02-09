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
  makeWebFetchTool,
  makeWebDownloadTool,
  makePdfExplainTool,
  makeAudioExplainTool,
  makeAtobTool,
  makeConsoleLogTool,
  // Topics API (exec-03)
  makeTopicsPeekTool,
  makeTopicsGetByIdsTool,
  makeTopicsPublishTool,
  // Topics registerInput (exec-15)
  makeTopicsRegisterInputTool,
  // Script tools (read-only, planner/maintainer)
  makeGetScriptTool,
  makeListScriptsTool,
  makeScriptHistoryTool,
  makeListScriptRunsTool,
  makeGetScriptRunTool,
  // File tools
  makeReadFileTool,
  makeSaveFileTool,
  makeListFilesTool,
  makeSearchFilesTool,
  // Text AI tools
  makeTextGenerateTool,
  makeTextSummarizeTool,
  makeTextClassifyTool,
  makeTextExtractTool,
  // Image AI tools
  makeImagesGenerateTool,
  makeImagesExplainTool,
  makeImagesTransformTool,
  // Connector tools
  makeGmailTool,
  makeGDriveTool,
  makeGSheetsTool,
  makeGDocsTool,
  makeNotionTool,
  // User communication
  makeUserSendTool,
  type UserSendContext,
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
  classifyGoogleApiError,
  formatUsageForEvent,
  type ErrorType,
  type EventUsageData,
  /** @deprecated Use getRunStatusForError from failure-handling instead */
  classifyGenericError,
  /** @deprecated Use getRunStatusForError from failure-handling instead */
  ensureClassified,
} from "./errors";

// Failure handling (exec-12)
export {
  errorTypeToRunStatus,
  getRunStatusForError,
  isDefiniteFailure,
  type ClassifiedResult,
} from "./failure-handling";

// Indeterminate mutation resolution (exec-14)
export {
  resolveIndeterminateMutation,
  getMutationResultForNext,
  getIndeterminateMutations,
  getIndeterminateMutationsForWorkflow,
  type IndeterminateResolution,
  type ResolutionResult,
  type MutationResult,
} from "./indeterminate-resolution";

// Scheduler state management (exec-11)
export {
  SchedulerStateManager,
  type WorkflowConfigForScheduler,
} from "./scheduler-state";

// Schedule utilities (exec-13)
export {
  parseInterval,
  computeNextRunTime,
  extractSchedule,
} from "./schedule-utils";

// Producer schedule initialization (exec-13)
export {
  initializeProducerSchedules,
  updateProducerSchedules,
  removeProducerSchedules,
} from "./producer-schedule-init";

// Intent extraction (exec-17)
export {
  extractIntent,
  parseIntentSpec,
  formatIntentForPrompt,
} from "./intent-extract";

// Reconciliation (exec-18)
export {
  ReconciliationRegistry,
  ReconciliationScheduler,
  registerGmailReconcileMethods,
  DEFAULT_RECONCILIATION_POLICY,
  calculateBackoff,
  type ReconcileResult,
  type MutationParams,
  type ReconcileMethod,
  type ReconcilableTool,
  type ReconciliationPolicy,
  type ReconciliationSchedulerConfig,
} from "./reconciliation";

export type {
  Sandbox,
  SandboxOptions,
  EvalOptions,
  EvalResult,
  EvalContext,
} from "./sandbox/sandbox";
