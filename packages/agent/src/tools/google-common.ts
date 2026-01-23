/**
 * Shared utilities for Google API tools (Gmail, Drive, Sheets, Docs).
 *
 * All Google services share the same OAuth client pattern and error handling.
 */

import { google } from "googleapis";
import type { ConnectionManager, Connection, OAuthCredentials } from "@app/connectors";
import { AuthError, LogicError } from "../errors";

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
        { source: toolName }
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
