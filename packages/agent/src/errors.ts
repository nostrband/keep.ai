/**
 * Error Classification System
 *
 * This module provides typed error classes for classifying errors by their root cause.
 * The classification determines how errors are routed:
 *
 * - AuthError, PermissionError, NetworkError → User notification (user must act)
 * - LogicError → Agent auto-fix (maintenance mode)
 *
 * See spec 09b-error-classification.md for full details.
 */

/** Error type enum for classification */
export type ErrorType = 'auth' | 'permission' | 'network' | 'logic';

/** Base class for classified errors */
export abstract class ClassifiedError extends Error {
  abstract readonly type: ErrorType;

  /** Original error that caused this classified error */
  readonly cause?: Error;

  /** Tool or component that produced this error */
  readonly source?: string;

  constructor(message: string, options?: { cause?: Error; source?: string }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options?.cause;
    this.source = options?.source;

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Convert to a plain object for serialization */
  toJSON() {
    return {
      type: this.type,
      name: this.name,
      message: this.message,
      source: this.source,
      stack: this.stack,
    };
  }
}

/**
 * Authentication error - OAuth expired, invalid credentials, etc.
 *
 * Routed to: User (must reconnect/re-authenticate)
 * Auto-retry: No
 *
 * HTTP triggers: 401 Unauthorized
 */
export class AuthError extends ClassifiedError {
  readonly type = 'auth' as const;

  constructor(message: string, options?: { cause?: Error; source?: string }) {
    super(message, options);
  }
}

/**
 * Permission error - Access denied, insufficient scope, etc.
 *
 * Routed to: User (must grant access)
 * Auto-retry: No
 *
 * HTTP triggers: 403 Forbidden
 * File triggers: EACCES
 */
export class PermissionError extends ClassifiedError {
  readonly type = 'permission' as const;

  constructor(message: string, options?: { cause?: Error; source?: string }) {
    super(message, options);
  }
}

/**
 * Network error - Connection failed, timeout, service unavailable, etc.
 *
 * Routed to: User (after N retries)
 * Auto-retry: Yes (exponential backoff, max 10 min)
 *
 * HTTP triggers: 5xx, timeout, connection refused
 */
export class NetworkError extends ClassifiedError {
  readonly type = 'network' as const;

  /** HTTP status code if applicable */
  readonly statusCode?: number;

  constructor(message: string, options?: { cause?: Error; source?: string; statusCode?: number }) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
    };
  }
}

/**
 * Logic error - Script bugs, unexpected data, parsing errors, null references.
 *
 * Routed to: Agent (auto-fix via maintenance mode)
 * Auto-retry: No (agent fixes then re-runs)
 *
 * HTTP triggers: 4xx (except 401, 403), parsing failures
 * Script triggers: TypeError, ReferenceError, unexpected data format
 */
export class LogicError extends ClassifiedError {
  readonly type = 'logic' as const;

  constructor(message: string, options?: { cause?: Error; source?: string }) {
    super(message, options);
  }
}

/**
 * Check if an error is a ClassifiedError
 */
export function isClassifiedError(error: unknown): error is ClassifiedError {
  return error instanceof ClassifiedError;
}

/**
 * Check if an error is of a specific type
 */
export function isErrorType<T extends ErrorType>(
  error: unknown,
  type: T
): error is ClassifiedError & { type: T } {
  return isClassifiedError(error) && error.type === type;
}

/**
 * Classify an HTTP response error into typed error
 *
 * @param statusCode HTTP status code
 * @param message Error message
 * @param options Additional error options
 */
export function classifyHttpError(
  statusCode: number,
  message: string,
  options?: { cause?: Error; source?: string }
): ClassifiedError {
  if (statusCode === 401) {
    return new AuthError(message, options);
  }

  if (statusCode === 403) {
    return new PermissionError(message, options);
  }

  if (statusCode >= 500 || statusCode === 408 || statusCode === 429) {
    // 5xx server errors, 408 timeout, 429 rate limit - all network/infrastructure
    return new NetworkError(message, { ...options, statusCode });
  }

  // 4xx client errors (except 401, 403) are logic errors
  // These indicate the script made a bad request
  return new LogicError(message, options);
}

/**
 * Classify a file system error into typed error
 *
 * @param err The original error
 * @param source The tool or component that produced the error
 */
export function classifyFileError(
  err: NodeJS.ErrnoException,
  source?: string
): ClassifiedError {
  const code = err.code;

  if (code === 'EACCES' || code === 'EPERM') {
    return new PermissionError(`Access denied: ${err.message}`, { cause: err, source });
  }

  if (code === 'ENOENT') {
    return new LogicError(`File not found: ${err.message}`, { cause: err, source });
  }

  if (code === 'ENOTDIR' || code === 'EISDIR') {
    return new LogicError(`Invalid path: ${err.message}`, { cause: err, source });
  }

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return new NetworkError(`Network error: ${err.message}`, { cause: err, source });
  }

  // Default to logic error for unknown file errors
  return new LogicError(err.message, { cause: err, source });
}

/**
 * Classify a generic error based on its message and type
 *
 * @param err The original error
 * @param source The tool or component that produced the error
 */
export function classifyGenericError(
  err: Error,
  source?: string
): ClassifiedError {
  const message = err.message.toLowerCase();

  // Check for auth-related keywords
  if (
    message.includes('unauthorized') ||
    message.includes('authentication') ||
    message.includes('oauth') ||
    message.includes('token expired') ||
    message.includes('invalid credentials') ||
    message.includes('login required')
  ) {
    return new AuthError(err.message, { cause: err, source });
  }

  // Check for permission-related keywords
  if (
    message.includes('forbidden') ||
    message.includes('access denied') ||
    message.includes('permission denied') ||
    message.includes('insufficient scope') ||
    message.includes('not authorized')
  ) {
    return new PermissionError(err.message, { cause: err, source });
  }

  // Check for network-related keywords
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout')
  ) {
    return new NetworkError(err.message, { cause: err, source });
  }

  // Default to logic error
  return new LogicError(err.message, { cause: err, source });
}

/**
 * Wrap an error in a ClassifiedError if it isn't already classified
 *
 * @param err The error to wrap
 * @param source The tool or component that produced the error
 */
export function ensureClassified(err: unknown, source?: string): ClassifiedError {
  if (isClassifiedError(err)) {
    return err;
  }

  if (err instanceof Error) {
    // Check if it's a Node.js error with a code
    if ('code' in err && typeof (err as any).code === 'string') {
      return classifyFileError(err as NodeJS.ErrnoException, source);
    }
    return classifyGenericError(err, source);
  }

  // Convert non-Error to LogicError
  return new LogicError(String(err), { source });
}

/**
 * Workflow paused error - thrown when a workflow is paused during execution.
 *
 * This is NOT routed for retry or auto-fix - it's a clean abort signal.
 * The workflow was intentionally stopped by the user.
 */
export class WorkflowPausedError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} was paused`);
    this.name = 'WorkflowPausedError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Check if an error is a WorkflowPausedError
 */
export function isWorkflowPausedError(error: unknown): error is WorkflowPausedError {
  return error instanceof WorkflowPausedError;
}

/**
 * Create a classified error from Google API errors (Gmail, etc.)
 *
 * @param err The Google API error
 * @param source The tool that made the API call
 */
export function classifyGoogleApiError(
  err: any,
  source?: string
): ClassifiedError {
  // Google API errors have a response with status
  const status = err?.response?.status || err?.status || err?.code;

  if (typeof status === 'number') {
    const message = err?.response?.data?.error?.message || err.message || String(err);
    return classifyHttpError(status, message, { cause: err, source });
  }

  // Check for specific Google API error types
  const message = err?.message || String(err);

  if (message.includes('invalid_grant') || message.includes('Token has been expired or revoked')) {
    return new AuthError('Gmail authentication expired. Please reconnect your account.', { cause: err, source });
  }

  return classifyGenericError(err instanceof Error ? err : new Error(String(err)), source);
}
