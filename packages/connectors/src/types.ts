/**
 * Types for the connectors package.
 *
 * This package handles OAuth2 authentication for external services like Gmail, Notion, etc.
 * It stores credentials in files and connection metadata in the database.
 */

/**
 * Identifies a specific connection (service + account).
 * Format: "{service}:{accountId}" e.g., "gmail:user@gmail.com"
 */
export interface ConnectionId {
  service: string;
  accountId: string;
}

/**
 * Parse a connection ID string into its components.
 */
export function parseConnectionId(id: string): ConnectionId {
  const colonIndex = id.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid connection ID format: ${id}`);
  }
  return {
    service: id.slice(0, colonIndex),
    accountId: id.slice(colonIndex + 1),
  };
}

/**
 * Format a ConnectionId as a string.
 */
export function formatConnectionId(id: ConnectionId): string {
  return `${id.service}:${id.accountId}`;
}

/**
 * OAuth2 URL/scope configuration (static per service).
 * clientId and clientSecret come from build-time secrets, not here.
 */
export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Additional params to include in auth URL (e.g., access_type, prompt) */
  extraAuthParams?: Record<string, string>;
  /** If true, use Basic auth for token exchange (Notion uses this) */
  useBasicAuth?: boolean;
}

/**
 * OAuth app credentials (client ID and secret).
 * These are injected at build time via tsup define.
 */
export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Stored OAuth credentials for a connection.
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Token expiration as Unix timestamp in milliseconds */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  /** Service-specific data (e.g., email for Google, workspace_name for Notion) */
  metadata?: Record<string, unknown>;
}

/**
 * Connection status.
 */
export type ConnectionStatus =
  | "connected" // Credentials exist and valid
  | "expired" // Token expired, needs refresh
  | "error" // Auth error, needs reconnect
  | "disconnected"; // No credentials

/**
 * Full connection record (metadata stored in database).
 */
export interface Connection {
  /** Unique ID: "{service}:{accountId}" */
  id: string;
  service: string;
  accountId: string;
  status: ConnectionStatus;
  /** User-friendly label, e.g., "Work Gmail" */
  label?: string;
  /** Error message if status is "error" */
  error?: string;
  createdAt: number;
  lastUsedAt?: number;
  /** Service-specific metadata (e.g., workspace_name for Notion) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of OAuth callback.
 */
export interface OAuthCallbackResult {
  success: boolean;
  connection?: Connection;
  error?: string;
}

/**
 * Service definition (implemented by each service).
 */
export interface ServiceDefinition {
  /** Service ID, e.g., "gmail" */
  id: string;
  /** Display name, e.g., "Gmail" */
  name: string;
  /** Icon name or URL */
  icon?: string;
  /** OAuth configuration (URLs, scopes) */
  oauthConfig: OAuthConfig;
  /**
   * Extract account ID from token response or profile.
   * For Google: email from profile
   * For Notion: workspace_id from token response
   */
  extractAccountId: (
    tokenResponse: TokenResponse,
    profile?: unknown
  ) => Promise<string>;
  /**
   * Extract display name for the connection.
   * For Google: email
   * For Notion: workspace_name
   */
  extractDisplayName?: (
    tokenResponse: TokenResponse,
    profile?: unknown
  ) => string | undefined;
  /**
   * Fetch user profile after auth (optional).
   * For Google: fetch from userinfo endpoint
   * For Notion: profile is in token response
   */
  fetchProfile?: (accessToken: string) => Promise<unknown>;
  /**
   * Whether this service supports token refresh.
   * Notion tokens don't expire, so no refresh needed.
   */
  supportsRefresh?: boolean;
}

/**
 * Raw token response from OAuth provider.
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  /** Notion-specific fields */
  workspace_id?: string;
  workspace_name?: string;
  workspace_icon?: string;
  bot_id?: string;
  owner?: unknown;
  /** Additional fields from provider */
  [key: string]: unknown;
}

/**
 * Database interface for connection metadata.
 * This is injected into ConnectionManager, not imported from @app/db.
 * Keeps the connectors package independent and testable.
 */
export interface ConnectionDb {
  getConnection(id: string): Promise<Connection | null>;
  listConnections(service?: string): Promise<Connection[]>;
  upsertConnection(connection: Connection): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  updateLastUsed(id: string, timestamp: number): Promise<void>;
}
