## Connectors 07: Notion Connector

### Goal

Add Notion as first non-Google OAuth connector. Validates that the framework is truly generic.

### Notion OAuth specifics

Notion OAuth differs from Google:
- Uses workspace-based authorization (not user email)
- Returns `workspace_id` and `workspace_name` in token response
- Bot token model - access granted to specific pages/databases
- No refresh tokens - access tokens are long-lived

### Service definition

```typescript
// packages/connectors/src/services/notion.ts

import { ServiceDefinition, OAuthCredentials } from '../types';

export const notionService: ServiceDefinition = {
  id: 'notion',
  name: 'Notion',
  icon: 'notion',
  oauthConfig: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],  // Notion doesn't use scopes in URL
    extraAuthParams: {
      owner: 'user',  // Request user-level access
    },
  },

  async extractAccountId(tokens: OAuthCredentials, profile?: unknown) {
    // Use workspace_id from token response metadata
    const metadata = tokens.metadata as { workspace_id: string };
    return metadata.workspace_id;
  },

  // Notion returns workspace info in token response, no separate profile fetch needed
  fetchProfile: undefined,
};
```

### OAuth flow differences

Notion token exchange returns additional fields:
```json
{
  "access_token": "secret_...",
  "token_type": "bearer",
  "bot_id": "...",
  "workspace_id": "...",
  "workspace_name": "My Workspace",
  "workspace_icon": "...",
  "owner": {
    "type": "user",
    "user": {
      "id": "...",
      "name": "User Name",
      "avatar_url": "..."
    }
  }
}
```

OAuthHandler needs to preserve this in metadata:
```typescript
async exchangeCode(code: string): Promise<OAuthCredentials> {
  const response = await fetch(this.config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Notion uses Basic auth for token exchange
      'Authorization': `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    }),
  });

  const data = await response.json();

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    // Notion tokens don't expire
    expiresAt: undefined,
    refreshToken: undefined,
    metadata: {
      workspace_id: data.workspace_id,
      workspace_name: data.workspace_name,
      workspace_icon: data.workspace_icon,
      bot_id: data.bot_id,
      owner: data.owner,
    },
  };
}
```

### Notion tool

```typescript
// packages/agent/src/tools/notion.ts

import { Client } from '@notionhq/client';
import { ConnectionManager } from '@app/connectors';

export function makeNotionTool(
  getContext: () => Context,
  connectionManager: ConnectionManager
) {
  return async (params: {
    method: string;
    params?: Record<string, unknown>;
    account: string;  // workspace_id - REQUIRED
  }) => {
    // Validate account is specified
    if (!params.account) {
      const connections = await connectionManager.listConnectionsByService('notion');
      if (connections.length === 0) {
        throw new AuthError('Notion not connected. Please connect in Settings.', { source: 'notion' });
      }
      // Show workspace names for better UX
      const accountList = connections.map(c => {
        const name = c.credentials?.metadata?.workspace_name;
        return name ? `${name} (${c.id.accountId})` : c.id.accountId;
      }).join(', ');
      throw new LogicError(`Notion account required. Available workspaces: ${accountList}`, { source: 'notion' });
    }

    const connectionId = { service: 'notion', accountId: params.account };

    const creds = await connectionManager.getCredentials(connectionId);

    const notion = new Client({ auth: creds.accessToken });

    try {
      // Route to Notion API method
      switch (params.method) {
        case 'databases.query':
          return await notion.databases.query(params.params as any);
        case 'databases.retrieve':
          return await notion.databases.retrieve(params.params as any);
        case 'pages.retrieve':
          return await notion.pages.retrieve(params.params as any);
        case 'pages.create':
          return await notion.pages.create(params.params as any);
        case 'pages.update':
          return await notion.pages.update(params.params as any);
        case 'blocks.children.list':
          return await notion.blocks.children.list(params.params as any);
        case 'blocks.children.append':
          return await notion.blocks.children.append(params.params as any);
        case 'search':
          return await notion.search(params.params as any);
        default:
          throw new LogicError(`Unknown Notion method: ${params.method}`, { source: 'notion' });
      }
    } catch (err: any) {
      throw classifyNotionError(err);
    }
  };
}
```

### Notion error classification

```typescript
// packages/agent/src/errors.ts

export function classifyNotionError(err: any, source = 'notion'): ClassifiedError {
  const status = err.status || err.code;
  const message = err.message || String(err);

  // Notion-specific error codes
  if (status === 401 || message.includes('unauthorized')) {
    return new AuthError(`Notion: ${message}`, { cause: err, source });
  }
  if (status === 403 || message.includes('restricted')) {
    return new PermissionError(`Notion: ${message}`, { cause: err, source });
  }
  if (status === 404) {
    return new LogicError(`Notion: Page or database not found`, { cause: err, source });
  }
  if (status === 429) {
    return new NetworkError(`Notion: Rate limited`, { cause: err, source, statusCode: 429 });
  }
  if (status >= 500) {
    return new NetworkError(`Notion: Service error`, { cause: err, source, statusCode: status });
  }

  return new LogicError(`Notion: ${message}`, { cause: err, source });
}
```

### Environment variables

```
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
```

### Connection display

Since Notion uses workspace_id (UUID), display workspace_name in UI:
```typescript
// In UI, show:
// "My Workspace" instead of "abc123-def456-..."

function getConnectionDisplayName(connection: Connection): string {
  if (connection.id.service === 'notion') {
    return connection.credentials?.metadata?.workspace_name || connection.id.accountId;
  }
  return connection.id.accountId;
}
```

### Multi-workspace support

User can connect multiple Notion workspaces. Each has separate:
- workspace_id (accountId)
- access_token
- permissions (pages/databases shared with integration)

### Notion OAuth app setup

In Notion Developer Portal:
1. Create integration
2. Set as "Public" integration
3. Add redirect URI: `http://localhost:PORT/api/connectors/notion/callback`
4. Set capabilities: Read content, Update content, Insert content
5. Copy OAuth client ID and secret

### No refresh needed

Notion access tokens don't expire. `getCredentials()` just returns stored token without refresh logic. If token becomes invalid (user revokes), next API call throws AuthError.

### Sandbox registration

```typescript
// packages/agent/src/sandbox/api.ts

addTool(global, "Notion", "api", makeNotionTool(ctx, connectionManager));
```

### Dependencies

Add to packages/agent:
```json
{
  "dependencies": {
    "@notionhq/client": "^2.2.0"
  }
}
```
