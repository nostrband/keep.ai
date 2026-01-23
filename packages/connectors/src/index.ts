/**
 * @app/connectors - OAuth2 connection management for external services.
 *
 * This package provides:
 * - Generic OAuth2 flow handling (authorization URL, code exchange, token refresh)
 * - File-based credential storage with secure file permissions
 * - Type definitions for connections and services
 * - Service-agnostic design (Google, Notion, etc.)
 *
 * Key design decisions:
 * - Credentials (sensitive) are stored in files at {userPath}/connectors/{service}/{accountId}.json
 * - Connection metadata (non-sensitive) is stored in database and syncs across clients
 * - Database interface is injected, not imported (keeps package testable and independent)
 * - OAuth app credentials are bundled at build time
 */

// Types
export * from "./types";

// OAuth handler
export { OAuthHandler, OAuthError, tokenResponseToCredentials } from "./oauth";

// Credential storage
export { CredentialStore } from "./store";

// Build-time credentials
export {
  getGoogleCredentials,
  getNotionCredentials,
  getCredentialsForService,
  hasCredentialsForService,
} from "./credentials";

// Connection manager
export { ConnectionManager, AuthError } from "./manager";

// Database adapter
export {
  ConnectionDbAdapter,
  createConnectionDbAdapter,
  type DbConnection,
  type DbConnectionStore,
} from "./db-adapter";
