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
export type ErrorType = 'auth' | 'permission' | 'network' | 'logic' | 'internal';

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

  /** OAuth error code if available (e.g., 'invalid_grant') */
  readonly errorCode?: string;

  constructor(message: string, options?: { cause?: Error; source?: string; errorCode?: string }) {
    super(message, options);
    this.errorCode = options?.errorCode;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      errorCode: this.errorCode,
    };
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
 * Internal error - Bugs in our code, bad requests from our side.
 *
 * Routed to: User (must contact support)
 * Auto-retry: No (can't be auto-fixed)
 *
 * Triggers: ERROR_BAD_REQUEST (400 from AI API due to invalid input),
 * unexpected internal state, coding bugs in the system itself.
 */
export class InternalError extends ClassifiedError {
  readonly type = 'internal' as const;

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
 * Classify a generic error based on its message and type.
 *
 * @deprecated Do not use. This function uses unreliable pattern matching on error messages.
 * Connectors must throw ClassifiedError explicitly. Unclassified errors should be treated
 * as InternalError (bug in our code). Use getRunStatusForError() from failure-handling.ts instead.
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
 * Wrap an error in a ClassifiedError if it isn't already classified.
 *
 * @deprecated Do not use. This function falls back to pattern matching via classifyGenericError.
 * Use getRunStatusForError() from failure-handling.ts instead, which treats unclassified
 * errors as InternalError (bug in our code) rather than LogicError.
 *
 * Per exec-12 spec: If a connector or tool throws an unclassified error, that's a bug
 * in our code that needs fixing, not a script bug that auto-fix should handle.
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

  // Convert non-Error to InternalError (changed from LogicError per exec-12)
  // Non-Error thrown from internal code is a bug
  return new InternalError(
    `Unclassified non-Error thrown${source ? ` in ${source}` : ''}: ${String(err)}`,
    { source }
  );
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

/**
 * Create a classified error from Notion API errors.
 *
 * Notion API error structure:
 * - status: HTTP status code
 * - code: Notion error code (e.g., "unauthorized", "restricted_resource", "object_not_found")
 * - message: Human-readable error message
 *
 * @param err The Notion API error
 * @param source The tool that made the API call
 */
export function classifyNotionError(
  err: any,
  source?: string
): ClassifiedError {
  // Notion API errors have status, code, and message
  const status = err?.status || err?.response?.status || err?.code;
  const notionCode = err?.code as string | undefined;
  const message = err?.message || err?.body?.message || String(err);

  // Handle numeric HTTP status codes
  if (typeof status === 'number') {
    return classifyHttpError(status, message, { cause: err, source });
  }

  // Handle Notion-specific error codes
  if (notionCode) {
    switch (notionCode) {
      case 'unauthorized':
      case 'invalid_token':
        return new AuthError('Notion authentication failed. Please reconnect your workspace.', { cause: err, source });

      case 'restricted_resource':
        return new PermissionError('Notion access denied. The integration may not have access to this page or database.', { cause: err, source });

      case 'object_not_found':
        return new LogicError(`Notion resource not found: ${message}`, { cause: err, source });

      case 'validation_error':
      case 'invalid_json':
      case 'invalid_request':
      case 'invalid_request_url':
        return new LogicError(`Notion request error: ${message}`, { cause: err, source });

      case 'rate_limited':
        return new NetworkError('Notion rate limit exceeded. Please try again later.', { cause: err, source, statusCode: 429 });

      case 'internal_server_error':
      case 'service_unavailable':
        return new NetworkError(`Notion service error: ${message}`, { cause: err, source, statusCode: 500 });

      case 'conflict_error':
        return new LogicError(`Notion conflict: ${message}`, { cause: err, source });

      case 'database_connection_unavailable':
        return new NetworkError('Notion database temporarily unavailable. Please try again.', { cause: err, source });
    }
  }

  // Fallback to generic classification
  return classifyGenericError(err instanceof Error ? err : new Error(String(err)), source);
}

/**
 * Type-safe usage data structure for tool events.
 *
 * This interface enforces the correct nested structure for cost tracking.
 * The cost is accumulated from tool calls and saved with the event.
 */
export interface EventUsageData {
  usage: {
    cost: number;
  };
}

/**
 * Format usage data for tool events in a type-safe way.
 *
 * This helper enforces the correct nested structure `{ usage: { cost: number } }`
 * that the cost tracking system expects. Using this helper prevents accidentally
 * passing `usage` directly instead of the nested structure.
 *
 * @param usage The usage object from API response (e.g., OpenRouter)
 * @returns Properly formatted usage data for createEvent
 *
 * @example
 * // In a tool that makes API calls:
 * await getContext().createEvent("text_generate", {
 *   promptLength: prompt.length,
 *   ...formatUsageForEvent(usage),
 * });
 */
export function formatUsageForEvent(usage: { cost?: number } | undefined): EventUsageData {
  return {
    usage: {
      cost: usage?.cost ?? 0,
    },
  };
}
