/**
 * Shared utilities for Google API tools (Gmail, Drive, Sheets, Docs).
 *
 * All Google services share the same OAuth client pattern and error handling.
 */

import { google } from "googleapis";
import type { ConnectionManager, Connection, OAuthCredentials } from "@app/connectors";
import {
  AuthError,
  LogicError,
  NetworkError,
  InternalError,
  classifyHttpError,
  type ClassifiedError,
} from "../errors";

/**
 * Get credentials for a Google service, with proper error handling.
 *
 * @param connectionManager - The connection manager to use
 * @param service - The service ID (gmail, gdrive, gsheets, gdocs)
 * @param accountId - The account email address (REQUIRED)
 * @param toolName - The tool name for error messages (e.g., "GoogleDrive.api")
 */
export async function getGoogleCredentials(
  connectionManager: ConnectionManager,
  service: string,
  accountId: string | undefined,
  toolName: string
): Promise<OAuthCredentials> {
  // Validate account is specified
  if (!accountId) {
    const connections = await connectionManager.listConnectionsByService(service);
    if (connections.length === 0) {
      const serviceName = getServiceDisplayName(service);
      throw new AuthError(
        `${serviceName} not connected. Please connect ${serviceName} in Settings.`,
        { source: toolName, serviceId: service, accountId: "" }
      );
    }
    throw new LogicError(
      `${getServiceDisplayName(service)} account required. Available accounts: ${connections.map((c: Connection) => c.accountId).join(", ")}`,
      { source: toolName }
    );
  }

  const connectionId = { service, accountId };
  return connectionManager.getCredentials(connectionId);
}

/**
 * Create an OAuth2 client configured with the given credentials.
 */
export function createGoogleOAuthClient(creds: OAuthCredentials) {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt,
  });
  return oAuth2Client;
}

/**
 * Get human-readable service name.
 */
function getServiceDisplayName(service: string): string {
  const names: Record<string, string> = {
    gmail: "Gmail",
    gdrive: "Google Drive",
    gsheets: "Google Sheets",
    gdocs: "Google Docs",
  };
  return names[service] || service;
}

/**
 * Classify a Google API error into a typed ClassifiedError.
 *
 * Google API errors come in several flavors:
 * - OAuth token errors (invalid_grant) return HTTP 400 which would be misclassified as LogicError
 * - Standard HTTP errors (401, 403, 5xx) from the API
 * - Network errors (ECONNREFUSED, etc.)
 *
 * @param err The Google API error
 * @param source The tool that made the API call (e.g. "Gmail.api")
 * @param serviceId The connector service ID (e.g. "gmail", "gdrive")
 * @param accountId The account identifier (e.g. email address)
 */
export function classifyGoogleApiError(
  err: any,
  source: string,
  serviceId: string,
  accountId: string
): ClassifiedError {
  const message = err?.message || String(err);

  // Check for auth-related error patterns first (before HTTP status),
  // because OAuth token errors return HTTP 400 which classifyHttpError
  // would misclassify as LogicError.
  if (message.includes('invalid_grant') || message.includes('Token has been expired or revoked')) {
    return new AuthError('Google authentication expired. Please reconnect your account.', {
      cause: err, source, serviceId, accountId,
    });
  }

  // Google API errors have a response with status
  const status = err?.response?.status || err?.status || err?.code;

  if (typeof status === 'number') {
    // Handle 401 explicitly — classifyHttpError doesn't create AuthError
    if (status === 401) {
      return new AuthError(`Google authentication failed (401): ${message}`, {
        cause: err, source, serviceId, accountId,
      });
    }
    const statusMessage = err?.response?.data?.error?.message || message;
    return classifyHttpError(status, statusMessage, { cause: err, source });
  }

  // Network-level errors
  const errCode = err?.code;
  if (typeof errCode === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(errCode)) {
    return new NetworkError(`Google API network error: ${message}`, { cause: err, source });
  }

  // Unrecognized error shape — internal error (bug in our classification)
  return new InternalError(`Unclassified Google API error: ${message}`, {
    cause: err instanceof Error ? err : undefined, source,
  });
}
