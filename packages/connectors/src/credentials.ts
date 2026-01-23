/**
 * OAuth app credentials bundled at build time.
 *
 * These values are replaced at build time by tsup's define option.
 * The actual credentials come from secrets.build.json or environment variables.
 *
 * For desktop OAuth apps, client secrets are considered public by design.
 * Security relies on redirect URI validation, not secret secrecy.
 * See specs/connectors-00-build-secrets.md for details.
 */

import type { OAuthAppCredentials } from "./types";

/**
 * Get Google OAuth credentials (used by Gmail, Drive, Sheets, Docs).
 */
export function getGoogleCredentials(): OAuthAppCredentials {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  };
}

/**
 * Get Notion OAuth credentials.
 */
export function getNotionCredentials(): OAuthAppCredentials {
  return {
    clientId: process.env.NOTION_CLIENT_ID || "",
    clientSecret: process.env.NOTION_CLIENT_SECRET || "",
  };
}

/**
 * Get credentials for a specific service.
 */
export function getCredentialsForService(service: string): OAuthAppCredentials {
  switch (service) {
    case "gmail":
    case "gdrive":
    case "gsheets":
    case "gdocs":
      return getGoogleCredentials();
    case "notion":
      return getNotionCredentials();
    default:
      throw new Error(`Unknown service: ${service}`);
  }
}

/**
 * Check if credentials are configured for a service.
 */
export function hasCredentialsForService(service: string): boolean {
  const creds = getCredentialsForService(service);
  return Boolean(creds.clientId && creds.clientSecret);
}
