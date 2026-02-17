/**
 * ConnectionManager - Central class for OAuth connection orchestration.
 *
 * Handles OAuth flows, manages credentials, provides credentials to tools,
 * and keeps database metadata in sync.
 *
 * See specs/connectors-02-connection-manager.md for design details.
 */

import createDebug from "debug";
import { randomUUID } from "crypto";
import { AuthError, isClassifiedError } from "@app/proto";
import { OAuthHandler, tokenResponseToCredentials, OAuthError } from "./oauth";
import { CredentialStore } from "./store";
import { getCredentialsForService } from "./credentials";
import type {
  Connection,
  ConnectionDb,
  ConnectionId,
  OAuthCallbackResult,
  OAuthCredentials,
  ServiceDefinition,
} from "./types";

const debug = createDebug("keep:connectors:manager");

/** Pending OAuth state stored in memory */
interface PendingState {
  service: string;
  redirectUri: string;
  timestamp: number;
}

/** Token refresh buffer: refresh 5 minutes before expiry */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** OAuth state TTL: 5 minutes (reduced from 10 for security) */
const STATE_TTL_MS = 5 * 60 * 1000;

/** Maximum pending OAuth states to prevent memory exhaustion DoS */
const MAX_PENDING_STATES = 100;

/** Cleanup interval for expired states (60 seconds) */
const STATE_CLEANUP_INTERVAL_MS = 60 * 1000;

/** Allowed redirect URI hosts for OAuth callbacks */
const ALLOWED_REDIRECT_HOSTS = ["127.0.0.1", "localhost"];

export class ConnectionManager {
  private services = new Map<string, ServiceDefinition>();
  private pendingStates = new Map<string, PendingState>();
  private refreshPromises = new Map<string, Promise<OAuthCredentials>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: CredentialStore,
    private db: ConnectionDb
  ) {
    // Start periodic cleanup of expired OAuth states
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredStates();
    }, STATE_CLEANUP_INTERVAL_MS);
  }

  /**
   * Shutdown the manager, cleaning up resources.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Register a service definition.
   */
  registerService(service: ServiceDefinition): void {
    debug("Registering service: %s", service.id);
    this.services.set(service.id, service);
  }

  /**
   * Get all registered services.
   */
  getServices(): ServiceDefinition[] {
    return Array.from(this.services.values());
  }

  /**
   * Get a registered service by ID.
   */
  getService(serviceId: string): ServiceDefinition | undefined {
    return this.services.get(serviceId);
  }

  /**
   * Validate that a redirect URI is allowed.
   */
  private isAllowedRedirectUri(redirectUri: string): boolean {
    try {
      const url = new URL(redirectUri);
      return ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Start OAuth flow for a service.
   * Returns the authorization URL and state parameter.
   */
  startOAuthFlow(
    serviceId: string,
    redirectUri: string
  ): { authUrl: string; state: string } {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Unknown service: ${serviceId}`);
    }

    // Validate redirect URI
    if (!this.isAllowedRedirectUri(redirectUri)) {
      throw new Error(`Invalid redirect URI: ${redirectUri}`);
    }

    // Lazy cleanup of expired states
    this.cleanupExpiredStates();

    // Enforce maximum pending states to prevent memory exhaustion DoS
    if (this.pendingStates.size >= MAX_PENDING_STATES) {
      // Remove oldest state
      let oldestState: string | null = null;
      let oldestTimestamp = Infinity;
      for (const [state, data] of this.pendingStates) {
        if (data.timestamp < oldestTimestamp) {
          oldestTimestamp = data.timestamp;
          oldestState = state;
        }
      }
      if (oldestState) {
        this.pendingStates.delete(oldestState);
        debug(
          "Pending states limit reached (%d), removed oldest state",
          MAX_PENDING_STATES
        );
      }
    }

    // Generate CSRF state
    const state = randomUUID();
    this.pendingStates.set(state, {
      service: serviceId,
      redirectUri,
      timestamp: Date.now(),
    });

    // Get OAuth credentials
    const { clientId, clientSecret } = getCredentialsForService(serviceId);
    if (!clientId || !clientSecret) {
      throw new Error(
        `OAuth credentials not configured for ${serviceId}. ` +
          "Check secrets.build.json or environment variables."
      );
    }

    // Create OAuth handler and generate URL
    const handler = new OAuthHandler(
      service.oauthConfig,
      clientId,
      clientSecret,
      redirectUri
    );

    const authUrl = handler.getAuthUrl(state);
    debug("Started OAuth flow for %s, state=%s", serviceId, state);

    return { authUrl, state };
  }

  /**
   * Complete OAuth flow after receiving callback.
   */
  async completeOAuthFlow(
    serviceId: string,
    code: string,
    state: string
  ): Promise<OAuthCallbackResult> {
    // Atomically retrieve and delete state to prevent replay attacks
    const pending = this.pendingStates.get(state);
    this.pendingStates.delete(state); // Delete immediately after retrieval

    if (!pending) {
      debug("Invalid or expired state: %s", state);
      return { success: false, error: "Invalid or expired state" };
    }

    // Check expiry (state already deleted, so no re-use possible)
    if (Date.now() - pending.timestamp > STATE_TTL_MS) {
      debug("OAuth flow expired: %s", state);
      return { success: false, error: "OAuth flow expired, please try again" };
    }

    // Check service matches
    if (pending.service !== serviceId) {
      debug(
        "State mismatch: expected %s, got %s",
        pending.service,
        serviceId
      );
      return { success: false, error: "State mismatch" };
    }

    // Re-validate redirect URI at completion
    if (!this.isAllowedRedirectUri(pending.redirectUri)) {
      debug("Invalid redirect URI in state: %s", pending.redirectUri);
      return { success: false, error: "Invalid redirect URI" };
    }

    const service = this.services.get(serviceId);
    if (!service) {
      return { success: false, error: `Unknown service: ${serviceId}` };
    }

    try {
      // Get OAuth credentials
      const { clientId, clientSecret } = getCredentialsForService(serviceId);

      // Exchange code for tokens
      const handler = new OAuthHandler(
        service.oauthConfig,
        clientId,
        clientSecret,
        pending.redirectUri
      );

      const tokenResponse = await handler.exchangeCode(code);
      const credentials = tokenResponseToCredentials(tokenResponse);

      // Fetch profile if the service supports it
      let profile: unknown;
      if (service.fetchProfile) {
        try {
          profile = await service.fetchProfile(credentials.accessToken);
        } catch (err) {
          debug("Failed to fetch profile for %s: %s", serviceId, err);
          // Profile fetch is optional, continue without it
        }
      }

      // Extract account ID
      const accountId = await service.extractAccountId(tokenResponse, profile);
      const connectionId: ConnectionId = { service: serviceId, accountId };

      // Store metadata from token response
      const metadata: Record<string, unknown> = { ...credentials.metadata };
      if (service.extractDisplayName) {
        const displayName = service.extractDisplayName(tokenResponse, profile);
        if (displayName) {
          metadata.displayName = displayName;
        }
      }
      credentials.metadata = metadata;

      // Save credentials to file
      await this.store.save(connectionId, credentials);

      // Create connection record
      const now = Date.now();
      const connection: Connection = {
        id: `${serviceId}:${accountId}`,
        service: serviceId,
        accountId,
        status: "connected",
        label: undefined,
        error: undefined,
        createdAt: now,
        lastUsedAt: undefined,
        metadata,
      };

      // Save to database
      await this.db.upsertConnection(connection);

      debug("OAuth flow completed for %s:%s", serviceId, accountId);
      return { success: true, connection };
    } catch (err) {
      // Log full error details server-side for debugging
      if (err instanceof OAuthError) {
        // Legacy OAuthError (should no longer be thrown but kept for safety)
        const details = err.getErrorDetails();
        debug(
          "OAuth flow failed for %s: code=%s desc=%s body=%s",
          serviceId,
          details.error,
          details.errorDescription,
          err.responseBody
        );
      } else if (isClassifiedError(err)) {
        // ClassifiedError from proto - already has user-friendly message
        debug("OAuth flow failed for %s: %s (type=%s)", serviceId, err.message, err.type);
      } else {
        debug("OAuth flow failed for %s: %s", serviceId, err);
      }

      // Return sanitized error message to client (no sensitive info)
      let userMessage: string;
      if (err instanceof OAuthError) {
        userMessage = err.getUserFriendlyMessage();
      } else if (isClassifiedError(err)) {
        // ClassifiedError messages are already user-friendly
        userMessage = err.message;
      } else {
        userMessage = "An authentication error occurred. Please try connecting again.";
      }

      return { success: false, error: userMessage };
    }
  }

  /**
   * Get all connections.
   */
  async listConnections(): Promise<Connection[]> {
    return this.db.listConnections();
  }

  /**
   * Get connections for a specific service.
   */
  async listConnectionsByService(service: string): Promise<Connection[]> {
    return this.db.listConnections(service);
  }

  /**
   * Get a specific connection.
   */
  async getConnection(id: ConnectionId): Promise<Connection | null> {
    return this.db.getConnection(`${id.service}:${id.accountId}`);
  }

  /**
   * Disconnect (remove) a connection.
   * Attempts to revoke the token at the provider before deleting locally.
   * @param id Connection to disconnect
   * @param revokeToken Whether to attempt token revocation (default: true)
   */
  async disconnect(id: ConnectionId, revokeToken = true): Promise<void> {
    const connectionId = `${id.service}:${id.accountId}`;
    debug("Disconnecting %s (revoke=%s)", connectionId, revokeToken);

    // Attempt token revocation before deleting credentials (spec: add-token-revocation-on-disconnect)
    if (revokeToken) {
      const service = this.services.get(id.service);
      if (service?.oauthConfig.revokeUrl) {
        try {
          const creds = await this.store.load(id);
          if (creds?.accessToken) {
            const { clientId, clientSecret } = getCredentialsForService(id.service);
            const handler = new OAuthHandler(
              service.oauthConfig,
              clientId,
              clientSecret,
              "" // redirectUri not needed for revocation
            );
            const result = await handler.revokeToken(creds.accessToken);
            if (result.reason === "revoked") {
              debug("Token revoked at provider for %s", connectionId);
            } else if (result.reason === "not_supported") {
              debug("Token revocation not supported for %s", connectionId);
            } else {
              debug("Token revocation failed for %s (continuing with local cleanup)", connectionId);
            }
          }
        } catch (error) {
          // Log but don't fail - local cleanup is more important
          debug("Token revocation error for %s: %s (continuing with local cleanup)", connectionId, error);
        }
      } else {
        debug("No revoke URL for %s, skipping token revocation", id.service);
      }
    }

    // Delete credentials file
    await this.store.delete(id);

    // Delete from database
    await this.db.deleteConnection(connectionId);
  }

  /**
   * Update connection label.
   */
  async updateLabel(id: ConnectionId, label: string): Promise<void> {
    const connection = await this.db.getConnection(
      `${id.service}:${id.accountId}`
    );
    if (connection) {
      await this.db.upsertConnection({ ...connection, label });
    }
  }

  /**
   * Get valid credentials for a connection, auto-refreshing if needed.
   * This is the main method tools use to get credentials.
   */
  async getCredentials(id: ConnectionId): Promise<OAuthCredentials> {
    const connectionId = `${id.service}:${id.accountId}`;

    // Load credentials from file
    const creds = await this.store.load(id);
    if (!creds) {
      throw new AuthError(`No credentials for ${connectionId}`, { source: "ConnectionManager.getCredentials", serviceId: id.service, accountId: id.accountId });
    }

    // Check if token needs refresh
    const service = this.services.get(id.service);
    const supportsRefresh = service?.supportsRefresh !== false;

    if (creds.expiresAt && supportsRefresh) {
      const needsRefresh = creds.expiresAt < Date.now() + REFRESH_BUFFER_MS;

      if (needsRefresh) {
        if (!creds.refreshToken) {
          await this.markError(id, "Token expired, no refresh token");
          throw new AuthError(`Token expired for ${connectionId}`, { source: "ConnectionManager.getCredentials", serviceId: id.service, accountId: id.accountId });
        }

        // Check if a refresh is already in progress for this connection
        const existingRefresh = this.refreshPromises.get(connectionId);
        if (existingRefresh) {
          debug("Waiting for existing refresh for %s", connectionId);
          return existingRefresh;
        }

        // Start new refresh and store the promise
        const refreshPromise = this.refreshToken(id, creds)
          .then((refreshed) => {
            this.refreshPromises.delete(connectionId);
            return refreshed;
          })
          .catch((err) => {
            this.refreshPromises.delete(connectionId);
            throw err;
          });

        this.refreshPromises.set(connectionId, refreshPromise);

        try {
          debug("Refreshing token for %s", connectionId);
          return await refreshPromise;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Token refresh failed";
          await this.markError(id, message);
          if (isClassifiedError(err)) {
            // Enrich AuthErrors from OAuthHandler with connection identity.
            // OAuthHandler is generic and creates AuthError with empty serviceId/accountId.
            if (err instanceof AuthError) {
              throw new AuthError(err.message, {
                cause: err.cause,
                source: err.source,
                serviceId: id.service,
                accountId: id.accountId,
                errorCode: err.errorCode,
              });
            }
            // Non-auth classified errors (NetworkError, etc.) pass through
            throw err;
          }
          // Unclassified error from refresh → AuthError with proper identity
          throw new AuthError(message, { source: "ConnectionManager.getCredentials", serviceId: id.service, accountId: id.accountId, cause: err instanceof Error ? err : undefined });
        }
      }
    }

    // Update last used timestamp
    await this.db.updateLastUsed(connectionId, Date.now());

    return creds;
  }

  /**
   * Refresh an access token.
   */
  private async refreshToken(
    id: ConnectionId,
    currentCreds: OAuthCredentials
  ): Promise<OAuthCredentials> {
    const service = this.services.get(id.service);
    if (!service) {
      throw new Error(`Unknown service: ${id.service}`);
    }

    const { clientId, clientSecret } = getCredentialsForService(id.service);
    const handler = new OAuthHandler(
      service.oauthConfig,
      clientId,
      clientSecret,
      "" // redirectUri not needed for refresh
    );

    const tokenResponse = await handler.refreshToken(currentCreds.refreshToken!);
    const newCreds = tokenResponseToCredentials(tokenResponse);

    // Preserve refresh token if not returned (some providers don't return it on refresh)
    if (!newCreds.refreshToken && currentCreds.refreshToken) {
      newCreds.refreshToken = currentCreds.refreshToken;
    }

    // Preserve metadata
    newCreds.metadata = currentCreds.metadata;

    // Save new credentials
    await this.store.save(id, newCreds);

    debug("Token refreshed for %s:%s", id.service, id.accountId);
    return newCreds;
  }

  /**
   * Mark a connection as errored.
   * Called by tools when they encounter auth errors.
   */
  async markError(id: ConnectionId, error: string): Promise<void> {
    const connectionId = `${id.service}:${id.accountId}`;
    debug("Marking error for %s: %s", connectionId, error);

    const connection = await this.db.getConnection(connectionId);
    if (connection) {
      await this.db.upsertConnection({
        ...connection,
        status: "error",
        error,
      });
    }
  }

  /**
   * Reconcile database with credential files on startup.
   */
  async reconcile(): Promise<void> {
    debug("Reconciling connections...");

    // Get all credential files
    const fileConnections = await this.store.listAll();
    const fileIds = new Set(
      fileConnections.map((c) => `${c.service}:${c.accountId}`)
    );

    // Get all database rows
    const dbConnections = await this.db.listConnections();
    const dbIds = new Set(dbConnections.map((c) => c.id));

    // File exists but no db row -> add to db (migration)
    for (const fileConn of fileConnections) {
      const id = `${fileConn.service}:${fileConn.accountId}`;
      if (!dbIds.has(id)) {
        debug("Adding missing db row for %s", id);
        const creds = await this.store.load(fileConn);
        const connection: Connection = {
          id,
          service: fileConn.service,
          accountId: fileConn.accountId,
          status: "connected",
          label: undefined,
          error: undefined,
          createdAt: Date.now(),
          lastUsedAt: undefined,
          metadata: creds?.metadata,
        };
        await this.db.upsertConnection(connection);
      }
    }

    // Db row exists but no file -> mark as error or delete
    for (const dbConn of dbConnections) {
      if (!fileIds.has(dbConn.id)) {
        debug("Credentials missing for %s, marking as error", dbConn.id);
        await this.db.upsertConnection({
          ...dbConn,
          status: "error",
          error: "Credentials file missing",
        });
      }
    }

    debug("Reconciliation complete");
  }

  /**
   * Clean up expired pending OAuth states.
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.pendingStates) {
      if (now - data.timestamp > STATE_TTL_MS) {
        this.pendingStates.delete(state);
      }
    }
  }
}

// Re-export AuthError from @app/proto for backward compatibility
export { AuthError } from "@app/proto";
