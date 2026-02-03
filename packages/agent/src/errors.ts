/**
 * Error Classification System
 *
 * This module re-exports the error classification system from @app/proto.
 * The canonical implementation is in @app/proto/src/errors.ts.
 *
 * See spec 09b-error-classification.md for full details.
 */

// Re-export everything from @app/proto for backward compatibility
// New code should import directly from @app/proto
export {
  // Types
  type ErrorType,
  type EventUsageData,

  // Base class and concrete error classes
  ClassifiedError,
  AuthError,
  PermissionError,
  NetworkError,
  LogicError,
  InternalError,
  WorkflowPausedError,

  // Type guards
  isClassifiedError,
  isErrorType,
  isWorkflowPausedError,

  // Classification helpers
  classifyHttpError,
  classifyFileError,
  classifyGenericError,
  classifyGoogleApiError,
  classifyNotionError,
  ensureClassified,

  // Usage formatting
  formatUsageForEvent,
} from "@app/proto";
