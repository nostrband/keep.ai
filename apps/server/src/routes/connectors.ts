/**
 * Connector API routes for OAuth connection management.
 *
 * These endpoints handle the OAuth flow for external services (Gmail, Google Drive, etc.)
 * and provide connection management (disconnect, check).
 *
 * See specs/connectors-04-server-endpoints.md for design details.
 */

import { FastifyInstance } from "fastify";
import { ConnectionManager, parseConnectionId } from "@app/connectors";
import createDebug from "debug";

const debug = createDebug("server:connectors");

/**
 * Register connector routes under /api prefix.
 *
 * @param fastify - Fastify instance
 * @param connectionManager - ConnectionManager instance for OAuth handling
 * @param getServerBaseUrl - Function to get server base URL for redirect URIs
 */
export async function registerConnectorRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager,
  getServerBaseUrl: () => string
): Promise<void> {
  /**
   * POST /connectors/:service/connect
   *
   * Start OAuth flow for a service.
   * Returns the authorization URL that the client should open in a popup/tab.
   */
  fastify.post<{ Params: { service: string } }>(
    "/connectors/:service/connect",
    async (request, reply) => {
      const { service } = request.params;

      debug("Starting OAuth flow for service: %s", service);

      // Check if service is registered
      const serviceDefinition = connectionManager.getService(service);
      if (!serviceDefinition) {
        return reply.status(400).send({
          error: `Unknown service: ${service}`,
          availableServices: connectionManager
            .getServices()
            .map((s) => s.id),
        });
      }

      try {
        const redirectUri = `${getServerBaseUrl()}/api/connectors/${service}/callback`;
        const { authUrl, state } = connectionManager.startOAuthFlow(
          service,
          redirectUri
        );

        debug("Generated auth URL for %s, state=%s", service, state);

        return { authUrl, state };
      } catch (error) {
        debug("Failed to start OAuth flow for %s: %s", service, error);
        return reply.status(500).send({
          error: "Failed to start OAuth flow",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  /**
   * GET /connectors/:service/callback
   *
   * OAuth callback endpoint. The OAuth provider redirects here after user consent.
   * Returns an HTML page that shows success/error and auto-closes.
   */
  fastify.get<{
    Params: { service: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>("/connectors/:service/callback", async (request, reply) => {
    const { service } = request.params;
    const { code, state, error } = request.query;

    debug("OAuth callback for %s: code=%s, error=%s", service, !!code, error);

    // Handle OAuth error (user denied, etc.)
    if (error) {
      return reply.type("text/html").send(renderErrorPage(error));
    }

    // Validate required params
    if (!code || !state) {
      return reply.type("text/html").send(
        renderErrorPage("Missing authorization code or state parameter")
      );
    }

    try {
      const result = await connectionManager.completeOAuthFlow(
        service,
        code,
        state
      );

      if (result.success && result.connection) {
        debug("OAuth flow completed successfully for %s", service);
        return reply.type("text/html").send(renderSuccessPage(result.connection));
      } else {
        debug("OAuth flow failed for %s: %s", service, result.error);
        return reply.type("text/html").send(
          renderErrorPage(result.error || "Unknown error")
        );
      }
    } catch (err) {
      debug("OAuth callback error for %s: %s", service, err);
      return reply.type("text/html").send(
        renderErrorPage(err instanceof Error ? err.message : "Unknown error")
      );
    }
  });

  /**
   * DELETE /connectors/:service/:accountId
   *
   * Disconnect (remove) a connection.
   * Deletes credentials file and database record.
   */
  fastify.delete<{ Params: { service: string; accountId: string } }>(
    "/connectors/:service/:accountId",
    async (request, reply) => {
      const { service, accountId } = request.params;

      debug("Disconnecting %s:%s", service, accountId);

      try {
        await connectionManager.disconnect({ service, accountId });
        return { success: true };
      } catch (error) {
        debug("Failed to disconnect %s:%s: %s", service, accountId, error);
        return reply.status(500).send({
          success: false,
          error: "Failed to disconnect",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  /**
   * POST /connectors/:service/:accountId/check
   *
   * Test that a connection works by making a simple API call.
   * Updates connection status in database if auth error.
   */
  fastify.post<{ Params: { service: string; accountId: string } }>(
    "/connectors/:service/:accountId/check",
    async (request, reply) => {
      const { service, accountId } = request.params;

      debug("Checking connection %s:%s", service, accountId);

      try {
        // Get credentials (this also handles token refresh)
        const credentials = await connectionManager.getCredentials({
          service,
          accountId,
        });

        // Get service definition for profile fetch
        const serviceDefinition = connectionManager.getService(service);
        if (!serviceDefinition) {
          return reply.status(400).send({
            success: false,
            error: `Unknown service: ${service}`,
          });
        }

        // Fetch profile if supported (this validates the token)
        let profile: unknown = null;
        if (serviceDefinition.fetchProfile) {
          profile = await serviceDefinition.fetchProfile(credentials.accessToken);
        }

        debug("Connection check successful for %s:%s", service, accountId);

        return {
          success: true,
          accountId,
          profile,
        };
      } catch (error) {
        debug("Connection check failed for %s:%s: %s", service, accountId, error);

        // Mark error in database
        await connectionManager.markError(
          { service, accountId },
          error instanceof Error ? error.message : "Connection check failed"
        );

        // Determine appropriate HTTP status code based on error type
        const errorMessage = error instanceof Error ? error.message : "Connection check failed";
        const errorMessageLower = errorMessage.toLowerCase();

        let statusCode = 500; // Default to internal server error
        if (
          errorMessageLower.includes("unauthorized") ||
          errorMessageLower.includes("invalid_grant") ||
          errorMessageLower.includes("token") ||
          errorMessageLower.includes("expired") ||
          errorMessageLower.includes("revoked") ||
          errorMessageLower.includes("invalid credentials")
        ) {
          statusCode = 401; // Auth error
        } else if (
          errorMessageLower.includes("unavailable") ||
          errorMessageLower.includes("timeout") ||
          errorMessageLower.includes("econnrefused") ||
          errorMessageLower.includes("service") ||
          errorMessageLower.includes("rate limit")
        ) {
          statusCode = 503; // Service unavailable
        }

        return reply.status(statusCode).send({
          success: false,
          error: errorMessage,
        });
      }
    }
  );

  /**
   * GET /connectors/list
   *
   * List all connections.
   * Returns connections from database (metadata only, not credentials).
   */
  fastify.get("/connectors/list", async () => {
    const connections = await connectionManager.listConnections();
    return { connections };
  });

  /**
   * GET /connectors/:service/list
   *
   * List connections for a specific service.
   */
  fastify.get<{ Params: { service: string } }>(
    "/connectors/:service/list",
    async (request) => {
      const { service } = request.params;
      const connections = await connectionManager.listConnectionsByService(service);
      return { connections };
    }
  );

  /**
   * GET /connectors/services
   *
   * List available services.
   */
  fastify.get("/connectors/services", async () => {
    const services = connectionManager.getServices().map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
    }));
    return { services };
  });
}

/**
 * Render success HTML page after OAuth completion.
 */
function renderSuccessPage(connection: { accountId: string; service: string }): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Keep.AI - Connected</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        background-color: #f5f5f5;
      }
      .container {
        text-align: center;
        background: white;
        padding: 40px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        max-width: 400px;
      }
      .logo {
        width: 64px;
        height: 64px;
        border: 2px solid #D6A642;
        border-radius: 4px;
        margin: 0 auto 20px auto;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: bold;
        color: #333;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 20px;
        color: #333;
      }
      .success {
        color: #28a745;
        margin: 20px 0;
      }
      .success h2 {
        margin: 0 0 10px 0;
      }
      .success p {
        margin: 0;
        color: #666;
        word-break: break-all;
      }
      .countdown {
        color: #666;
        font-size: 14px;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="logo">K</div>
      <div class="title">Keep.AI</div>
      <div class="success">
        <h2>Connected!</h2>
        <p>${escapeHtml(connection.service)} account connected:<br><strong>${escapeHtml(connection.accountId)}</strong></p>
      </div>
      <p>You can close this window and return to the app.</p>
      <div class="countdown">This window will close in <span id="countdown">5</span> seconds</div>
    </div>
    <script>
      let timeLeft = 5;
      const countdownEl = document.getElementById('countdown');
      const timer = setInterval(() => {
        timeLeft--;
        countdownEl.textContent = timeLeft;
        if (timeLeft <= 0) {
          clearInterval(timer);
          window.close();
        }
      }, 1000);
    </script>
  </body>
</html>`;
}

/**
 * Render error HTML page after OAuth failure.
 */
function renderErrorPage(errorMessage: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Keep.AI - Connection Failed</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        background-color: #f5f5f5;
      }
      .container {
        text-align: center;
        background: white;
        padding: 40px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        max-width: 400px;
      }
      .logo {
        width: 64px;
        height: 64px;
        border: 2px solid #D6A642;
        border-radius: 4px;
        margin: 0 auto 20px auto;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: bold;
        color: #333;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 20px;
        color: #333;
      }
      .error {
        color: #dc3545;
        margin: 20px 0;
      }
      .error h2 {
        margin: 0 0 10px 0;
      }
      .error p {
        margin: 0;
        color: #666;
        word-break: break-word;
      }
      .countdown {
        color: #666;
        font-size: 14px;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="logo">K</div>
      <div class="title">Keep.AI</div>
      <div class="error">
        <h2>Connection Failed</h2>
        <p>${escapeHtml(errorMessage)}</p>
      </div>
      <p>Please close this window and try again.</p>
      <div class="countdown">This window will close in <span id="countdown">5</span> seconds</div>
    </div>
    <script>
      let timeLeft = 5;
      const countdownEl = document.getElementById('countdown');
      const timer = setInterval(() => {
        timeLeft--;
        countdownEl.textContent = timeLeft;
        if (timeLeft <= 0) {
          clearInterval(timer);
          window.close();
        }
      }, 1000);
    </script>
  </body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
