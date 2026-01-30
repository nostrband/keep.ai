/**
 * Generic OAuth2 flow handler.
 *
 * Supports both standard OAuth2 (Google) and Basic auth token exchange (Notion).
 */

import createDebug from "debug";
import { AuthError, NetworkError, classifyHttpError } from "@app/proto";
import type { OAuthConfig, OAuthCredentials, TokenResponse } from "./types";

const debug = createDebug("keep:connectors:oauth");

/**
 * Result of a token revocation attempt.
 * Provides clear distinction between actual revocation and other outcomes.
 */
export type RevokeResult = {
  success: boolean;
  reason: "revoked" | "not_supported" | "failed";
};

export class OAuthHandler {
  constructor(
    private config: OAuthConfig,
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

  /**
   * Generate the OAuth authorization URL.
   * User should be redirected to this URL to start the OAuth flow.
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
    });

    // Add scopes if present
    if (this.config.scopes.length > 0) {
      params.set("scope", this.config.scopes.join(" "));
    }

    // Add state for CSRF protection
    if (state) {
      params.set("state", state);
    }

    // Add extra auth params (e.g., access_type=offline, prompt=consent for Google)
    if (this.config.extraAuthParams) {
      for (const [key, value] of Object.entries(this.config.extraAuthParams)) {
        params.set(key, value);
      }
    }

    const url = `${this.config.authUrl}?${params.toString()}`;
    debug("Generated auth URL: %s", url.replace(this.clientId, "[CLIENT_ID]"));
    return url;
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeCode(code: string): Promise<TokenResponse> {
    debug("Exchanging code for tokens");

    const body = new URLSearchParams({
      code,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
    });

    // For Basic auth (Notion), credentials go in header
    // For standard OAuth2 (Google), credentials go in body
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (this.config.useBasicAuth) {
      const basicAuth = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${basicAuth}`;
    } else {
      body.set("client_id", this.clientId);
      body.set("client_secret", this.clientSecret);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debug("Token exchange failed: %s %s", response.status, errorText);
      const errorCode = parseOAuthErrorCode(errorText);
      const userMessage = getOAuthUserMessage(errorCode);
      throw classifyHttpError(response.status, userMessage, {
        source: "oauth.exchangeCode",
        cause: new Error(`Token exchange failed: ${response.status} - ${errorText}`),
      });
    }

    const data = (await response.json()) as TokenResponse;
    debug("Token exchange successful");
    return data;
  }

  /**
   * Refresh an expired access token.
   * Returns new credentials (preserves refresh_token if not returned).
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    debug("Refreshing access token");

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (this.config.useBasicAuth) {
      const basicAuth = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${basicAuth}`;
    } else {
      body.set("client_id", this.clientId);
      body.set("client_secret", this.clientSecret);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debug("Token refresh failed: %s %s", response.status, errorText);
      const errorCode = parseOAuthErrorCode(errorText);
      const userMessage = getOAuthUserMessage(errorCode);
      throw classifyHttpError(response.status, userMessage, {
        source: "oauth.refreshToken",
        cause: new Error(`Token refresh failed: ${response.status} - ${errorText}`),
      });
    }

    const data = (await response.json()) as TokenResponse;
    debug("Token refresh successful");
    return data;
  }

  /**
   * Revoke an access token at the OAuth provider.
   * Returns result indicating what happened (revoked, not_supported, or failed).
   * Best-effort: failures don't throw, just return { success: false, reason: "failed" }.
   */
  async revokeToken(accessToken: string): Promise<RevokeResult> {
    if (!this.config.revokeUrl) {
      debug("No revoke URL configured, skipping token revocation");
      return { success: true, reason: "not_supported" };
    }

    debug("Revoking access token");

    try {
      const body = new URLSearchParams({
        token: accessToken,
      });

      // Include client credentials matching the pattern used in exchangeCode
      // For Basic auth (Notion), credentials go in header
      // For standard OAuth2 (Google), credentials go in body
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      if (this.config.useBasicAuth) {
        const basicAuth = Buffer.from(
          `${this.clientId}:${this.clientSecret}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${basicAuth}`;
      } else {
        body.set("client_id", this.clientId);
        body.set("client_secret", this.clientSecret);
      }

      const response = await fetch(this.config.revokeUrl, {
        method: "POST",
        headers,
        body: body.toString(),
      });

      // Google returns 200 on success, even for already-revoked tokens
      if (response.ok) {
        debug("Token revocation successful");
        return { success: true, reason: "revoked" };
      }

      // Non-2xx response - revocation failed but we should continue with disconnect
      const errorText = await response.text();
      debug("Token revocation failed: %s %s", response.status, errorText);
      return { success: false, reason: "failed" };
    } catch (error) {
      // Network error - log and continue with disconnect
      debug("Token revocation error: %s", error);
      return { success: false, reason: "failed" };
    }
  }
}

/**
 * Convert raw token response to stored credentials format.
 */
export function tokenResponseToCredentials(
  response: TokenResponse
): OAuthCredentials {
  const credentials: OAuthCredentials = {
    accessToken: response.access_token,
    tokenType: response.token_type,
    scope: response.scope,
  };

  if (response.refresh_token) {
    credentials.refreshToken = response.refresh_token;
  }

  if (response.expires_in) {
    // Convert expires_in (seconds) to expiresAt (Unix timestamp ms)
    credentials.expiresAt = Date.now() + response.expires_in * 1000;
  }

  // Store service-specific metadata
  const metadata: Record<string, unknown> = {};

  // Notion-specific fields
  if (response.workspace_id) {
    metadata.workspace_id = response.workspace_id;
  }
  if (response.workspace_name) {
    metadata.workspace_name = response.workspace_name;
  }
  if (response.workspace_icon) {
    metadata.workspace_icon = response.workspace_icon;
  }
  if (response.bot_id) {
    metadata.bot_id = response.bot_id;
  }
  if (response.owner) {
    metadata.owner = response.owner;
  }

  if (Object.keys(metadata).length > 0) {
    credentials.metadata = metadata;
  }

  return credentials;
}

/** Map of OAuth error codes to user-friendly messages */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_grant:
    "Authorization expired or invalid. Please try connecting again.",
  invalid_client: "OAuth configuration error. Please contact support.",
  access_denied:
    "Access was denied. Please try again and approve all permissions.",
  invalid_request: "Invalid request. Please try connecting again.",
  unauthorized_client:
    "This app is not authorized. Please contact support.",
  unsupported_grant_type: "OAuth configuration error. Please contact support.",
  invalid_scope:
    "The requested permissions are not available. Please contact support.",
  server_error:
    "The service is temporarily unavailable. Please try again later.",
  temporarily_unavailable:
    "The service is temporarily unavailable. Please try again later.",
  interaction_required: "Please complete the sign-in process in the browser.",
  login_required: "Please sign in to continue.",
  consent_required: "Please approve the requested permissions to continue.",
};

/** Default message for unknown OAuth errors */
const DEFAULT_OAUTH_ERROR_MESSAGE =
  "An authentication error occurred. Please try connecting again.";

/**
 * Parse OAuth error code from response body.
 * @internal
 */
function parseOAuthErrorCode(responseBody: string): string | undefined {
  try {
    const data = JSON.parse(responseBody);
    return data.error;
  } catch {
    return undefined;
  }
}

/**
 * Get user-friendly message for OAuth error code.
 * @internal
 */
function getOAuthUserMessage(errorCode: string | undefined): string {
  if (errorCode && OAUTH_ERROR_MESSAGES[errorCode]) {
    return OAUTH_ERROR_MESSAGES[errorCode];
  }
  return DEFAULT_OAUTH_ERROR_MESSAGE;
}

/**
 * OAuth-specific error with response details.
 * @deprecated Use ClassifiedError from @app/proto instead.
 * Kept for backward compatibility with code that catches OAuthError.
 */
export class OAuthError extends Error {
  public readonly errorCode?: string;

  constructor(
    message: string,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = "OAuthError";

    // Extract error code from response body
    if (responseBody) {
      try {
        const data = JSON.parse(responseBody);
        this.errorCode = data.error;
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Parse error details from response body.
   * Used for internal logging only - contains sensitive info.
   */
  getErrorDetails(): { error?: string; errorDescription?: string } {
    if (!this.responseBody) {
      return {};
    }
    try {
      const data = JSON.parse(this.responseBody);
      return {
        error: data.error,
        errorDescription: data.error_description,
      };
    } catch {
      return {};
    }
  }

  /**
   * Get a user-friendly error message that doesn't leak internal details.
   */
  getUserFriendlyMessage(): string {
    if (this.errorCode && OAUTH_ERROR_MESSAGES[this.errorCode]) {
      return OAUTH_ERROR_MESSAGES[this.errorCode];
    }
    return DEFAULT_OAUTH_ERROR_MESSAGE;
  }
}
