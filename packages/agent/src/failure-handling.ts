/**
 * Failure Handling Module (exec-12)
 *
 * This module provides error classification and failure routing without pattern matching.
 * The key principle is: errors must be classified at the source, not at consumption.
 *
 * - Connectors throw ClassifiedError with correct type (AuthError, NetworkError, etc.)
 * - ToolWrapper throws ClassifiedError for phase violations
 * - Sandbox exceptions from user script code → LogicError
 * - Unclassified exceptions from internal code → InternalError (bug in our code)
 *
 * See specs/exec-12-failure-classification.md for full details.
 */

import {
  ClassifiedError,
  InternalError,
  isClassifiedError,
  ErrorType,
} from "@app/proto";
import { RunStatus } from "@app/db";

/**
 * Map ClassifiedError type to RunStatus.
 *
 * Per exec-12 spec:
 * - auth/permission → paused:approval (needs user action)
 * - network → paused:transient (will auto-retry with backoff)
 * - logic → failed:logic (auto-fix eligible)
 * - internal → failed:internal (bug in our code)
 */
export function errorTypeToRunStatus(errorType: ErrorType): RunStatus {
  const mapping: Record<ErrorType, RunStatus> = {
    auth: "paused:approval",
    permission: "paused:approval",
    network: "paused:transient",
    logic: "failed:logic",
    internal: "failed:internal",
    api_key: "failed:internal",
    balance: "failed:internal",
  };
  return mapping[errorType];
}

/**
 * Result from getRunStatusForError.
 */
export interface ClassifiedResult {
  /** The run status to set based on error type */
  status: RunStatus;
  /** The classified error (original if already classified, or wrapped InternalError) */
  error: ClassifiedError;
}

/**
 * Classify error and get run status.
 *
 * STRICT POLICY: No pattern matching on error messages.
 *
 * - If already ClassifiedError, use its type directly
 * - If not ClassifiedError, it's an InternalError (bug in our code)
 *
 * The rationale is: if a connector or tool throws an unclassified error,
 * that's a bug in our code that needs fixing, not a script bug that
 * auto-fix should handle. Unclassified errors should never leak through
 * properly implemented connectors.
 *
 * @param error - The error to classify
 * @param source - Where the error came from (for logging/debugging)
 * @returns The run status and classified error
 */
export function getRunStatusForError(
  error: unknown,
  source?: string
): ClassifiedResult {
  // If already classified, use it directly
  if (isClassifiedError(error)) {
    return {
      status: errorTypeToRunStatus(error.type),
      error,
    };
  }

  // Unclassified error = internal bug (connector/wrapper not classifying properly)
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  const internalError = new InternalError(
    source
      ? `Unclassified error in ${source}: ${message}`
      : `Unclassified error: ${message}`,
    { cause: error instanceof Error ? error : undefined, source }
  );

  return {
    status: "failed:internal",
    error: internalError,
  };
}

/**
 * Check if an error is a definite failure (vs potentially indeterminate).
 *
 * Used to decide mutation status when an error occurs during mutate phase.
 * Definite failures mean the mutation definitely did NOT happen.
 *
 * - Logic errors (script bugs, validation) → mutation couldn't have run
 * - Permission errors (403) → request was rejected before mutation
 * - Auth errors might be indeterminate (could have expired mid-request)
 * - Network errors are indeterminate (request may have succeeded)
 *
 * @param error - The classified error
 * @returns true if the error means mutation definitely did not happen
 */
export function isDefiniteFailure(error: ClassifiedError): boolean {
  // Logic errors and permission errors are definite failures
  // Network errors and auth errors might be indeterminate
  return error.type === "logic" || error.type === "permission";
}
