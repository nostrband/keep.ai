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

/** OAuth state TTL: 10 minutes */
const STATE_TTL_MS = 10 * 60 * 1000;

export class ConnectionManager {
  private services = new Map<string, ServiceDefinition>();
  private pendingStates = new Map<string, PendingState>();

  constructor(
    private store: CredentialStore,
    private db: ConnectionDb
  ) {}

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

    // Lazy cleanup of expired states
    this.cleanupExpiredStates();

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
    // Validate state
    const pending = this.pendingStates.get(state);
    if (!pending) {
      debug("Invalid or expired state: %s", state);
      return { success: false, error: "Invalid or expired state" };
    }

    // Check expiry
    if (Date.now() - pending.timestamp > STATE_TTL_MS) {
      this.pendingStates.delete(state);
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

    // Consume the state
    this.pendingStates.delete(state);

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
      const message =
        err instanceof OAuthError
          ? err.getErrorDetails().errorDescription || err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";

      debug("OAuth flow failed for %s: %s", serviceId, message);
      return { success: false, error: message };
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
   */
  async disconnect(id: ConnectionId): Promise<void> {
    const connectionId = `${id.service}:${id.accountId}`;
    debug("Disconnecting %s", connectionId);

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
      throw new AuthError(`No credentials for ${connectionId}`);
    }

    // Check if token needs refresh
    const service = this.services.get(id.service);
    const supportsRefresh = service?.supportsRefresh !== false;

    if (creds.expiresAt && supportsRefresh) {
      const needsRefresh = creds.expiresAt < Date.now() + REFRESH_BUFFER_MS;

      if (needsRefresh) {
        if (!creds.refreshToken) {
          await this.markError(id, "Token expired, no refresh token");
          throw new AuthError(`Token expired for ${connectionId}`);
        }

        try {
          debug("Refreshing token for %s", connectionId);
          const refreshed = await this.refreshToken(id, creds);
          return refreshed;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Token refresh failed";
          await this.markError(id, message);
          throw new AuthError(message);
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

/**
 * Auth error for credential/token issues.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
