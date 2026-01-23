## Connectors 04: Server API Endpoints

### Goal

Replace Gmail-specific endpoints with generic connector endpoints. Minimal set - most data comes from db sync.

### Endpoints

| Endpoint | Method | Purpose | Why needed |
|----------|--------|---------|------------|
| `/api/connectors/:service/connect` | POST | Start OAuth flow | Server has secrets, generates auth URL |
| `/api/connectors/:service/callback` | GET | OAuth callback | Server exchanges code for tokens |
| `/api/connectors/:service/:accountId` | DELETE | Disconnect | Server must delete credential files |
| `/api/connectors/:service/:accountId/check` | POST | Test connection | Server makes API call to verify |

### What's NOT an endpoint (read from db instead)

| Data | Source |
|------|--------|
| Available services | Hardcoded in client (static list) |
| Connection list | `SELECT * FROM connections` |
| Connection details | `SELECT * FROM connections WHERE id=?` |
| Connection status | `status` column in db |
| Update label | `UPDATE connections SET label=?` (client writes to local db, syncs) |

### POST /api/connectors/:service/connect

Start OAuth flow for a service.

**Request:**
```json
{}
```

Server knows the redirect URI (constructs from its own address).

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "abc123"
}
```

Frontend opens `authUrl` in popup/new tab.

### GET /api/connectors/:service/callback

OAuth callback endpoint. Google/Notion redirects here after user consent.

**Query params:**
- `code`: Authorization code
- `state`: CSRF state
- `error`: OAuth error (if denied)

**Actions:**
1. Exchange code for tokens (uses client secret)
2. Fetch user profile (to get accountId/email)
3. Save tokens to file
4. Insert/update `connections` table in db (syncs to clients)

**Response:** HTML page that:
1. Shows success/error message
2. Closes itself after delay (or prompts user to close)

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Connected!</h1>
  <p>You can close this window and return to the app.</p>
  <script>
    // Try to close automatically (may not work in all browsers)
    setTimeout(() => window.close(), 2000);
  </script>
</body>
</html>
```

**Note:** No postMessage needed - the connection is written to db, which syncs to UI automatically. Works for both web and Electron (where OAuth opens in external browser).

### DELETE /api/connectors/:service/:accountId

Disconnect/remove connection.

**Actions:**
1. Delete credential file from disk
2. Delete row from `connections` table (syncs to clients)

**Response:**
```json
{ "success": true }
```

### POST /api/connectors/:service/:accountId/check

Test that connection works (make a simple API call).

**Actions:**
1. Load credentials from file
2. Make test API call (e.g., Gmail getProfile, Notion users.me)
3. If fails with auth error, update `connections.status='error'` in db

**Response:**
```json
{
  "success": true,
  "profile": {
    "email": "user@gmail.com",
    "name": "User Name"
  }
}
```

Or on error:
```json
{
  "success": false,
  "error": "Token has been revoked"
}
```

### Server implementation

```typescript
// apps/server/src/routes/connectors.ts

import { FastifyInstance } from 'fastify';
import { ConnectionManager } from '@app/connectors';

export function registerConnectorRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager,
  db: KeepDb
) {
  // Start OAuth
  fastify.post('/api/connectors/:service/connect', async (req) => {
    const { service } = req.params as { service: string };
    const redirectUri = `${getServerBaseUrl()}/api/connectors/${service}/callback`;
    return connectionManager.startOAuthFlow(service, redirectUri);
  });

  // OAuth callback
  fastify.get('/api/connectors/:service/callback', async (req, reply) => {
    const { service } = req.params as { service: string };
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return reply.type('text/html').send(renderErrorPage(error));
    }

    const redirectUri = `${getServerBaseUrl()}/api/connectors/${service}/callback`;
    const result = await connectionManager.completeOAuthFlow(service, code, state, redirectUri);

    // completeOAuthFlow writes to db internally, which syncs to clients

    if (result.success) {
      return reply.type('text/html').send(renderSuccessPage(result.connection));
    } else {
      return reply.type('text/html').send(renderErrorPage(result.error));
    }
  });

  // Disconnect
  fastify.delete('/api/connectors/:service/:accountId', async (req) => {
    const { service, accountId } = req.params as { service: string; accountId: string };
    await connectionManager.disconnect({ service, accountId });
    // disconnect() deletes file and db row, which syncs to clients
    return { success: true };
  });

  // Test connection
  fastify.post('/api/connectors/:service/:accountId/check', async (req) => {
    const { service, accountId } = req.params as { service: string; accountId: string };
    try {
      const profile = await connectionManager.checkConnection({ service, accountId });
      return { success: true, profile };
    } catch (err: any) {
      // checkConnection() updates db status on auth error
      return { success: false, error: err.message };
    }
  });
}
```

### Deprecate old endpoints

Old endpoints to remove after migration:
- `/api/gmail/status`
- `/api/gmail/connect`
- `/api/gmail/callback`
- `/api/gmail/check`

Add deprecation period: old endpoints redirect to new ones or return deprecation warning.

### Redirect URI configuration

Each service may need different redirect URIs registered in their OAuth console:
- Gmail/Google: `http://127.0.0.1:PORT/api/connectors/gmail/callback`
- Notion: `http://127.0.0.1:PORT/api/connectors/notion/callback`

### Server base URL

The server needs to construct redirect URIs. Implementation:

```typescript
// apps/server/src/server.ts

function getServerBaseUrl(): string {
  // Server knows its port from startup config
  const port = config.port || 4681;
  // Always use 127.0.0.1 for local OAuth (more reliable than localhost)
  return `http://127.0.0.1:${port}`;
}
```

This matches current behavior where port is configured at startup (default 4681).

**Note:** For OAuth providers, register both `127.0.0.1` and `localhost` variants in the allowed redirect URIs, since some systems resolve differently.
