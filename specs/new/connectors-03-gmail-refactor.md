## Connectors 03: Gmail Refactor

### Goal

Move existing Gmail integration into the connectors framework. Gmail becomes the reference implementation for Google services.

### Current locations to refactor

| File | What to do |
|------|------------|
| `apps/server/src/server.ts` (lines 88-190) | Extract OAuth setup to service definition |
| `apps/server/src/server.ts` (lines 1104-1490) | Replace with generic connector endpoints |
| `packages/agent/src/tools/gmail.ts` | Update to use ConnectionManager |
| `apps/cli/src/commands/gmail.ts` | Update to use connectors package |

### Gmail service definition

```typescript
// packages/connectors/src/services/google.ts

import { ServiceDefinition } from '../types';

// Shared Google OAuth config
export const googleOAuthBase = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  extraAuthParams: {
    access_type: 'offline',
    prompt: 'consent',  // Force refresh token
  },
};

export const gmailService: ServiceDefinition = {
  id: 'gmail',
  name: 'Gmail',
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },

  async extractAccountId(tokens, profile) {
    // Profile contains email from Google userinfo
    return (profile as { email: string }).email;
  },

  async fetchProfile(accessToken) {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.json();
  },
};
```

### Updated Gmail tool

```typescript
// packages/agent/src/tools/gmail.ts

import { ConnectionManager } from '@app/connectors';
import { google } from 'googleapis';
import { classifyGoogleApiError } from '../errors';

export function makeGmailTool(
  getContext: () => Context,
  connectionManager: ConnectionManager
) {
  return async (params: {
    method: string;
    params?: Record<string, unknown>;
    account: string;  // REQUIRED: explicit account
  }) => {
    const ctx = getContext();

    // Validate account is specified
    if (!params.account) {
      const connections = await connectionManager.listConnectionsByService('gmail');
      if (connections.length === 0) {
        throw new AuthError('Gmail not connected. Please connect Gmail in Settings.', { source: 'gmail' });
      }
      throw new LogicError(
        `Gmail account required. Available accounts: ${connections.map(c => c.id.accountId).join(', ')}`
      );
    }

    const connectionId = { service: 'gmail', accountId: params.account };

    try {
      // Get fresh credentials
      const creds = await connectionManager.getCredentials(connectionId);

      // Create OAuth client
      const oAuth2Client = new google.auth.OAuth2();
      oAuth2Client.setCredentials({
        access_token: creds.accessToken,
        refresh_token: creds.refreshToken,
        expiry_date: creds.expiresAt,
      });

      // Make API call
      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
      // ... existing method routing logic ...

    } catch (err) {
      // classifyGoogleApiError already exists in @app/agent/errors.ts
      // It returns ClassifiedError with proper { cause, source } options
      const classified = classifyGoogleApiError(err, 'gmail');
      if (classified.type === 'auth') {
        await connectionManager.markError(connectionId, classified.message);
      }
      throw classified;
    }
  };
}
```

### Migration of existing credentials

On server startup:
```typescript
// Check for old gmail.json
const oldGmailPath = path.join(userPath, 'gmail.json');
if (await fileExists(oldGmailPath)) {
  try {
    const oldCreds = JSON.parse(await readFile(oldGmailPath, 'utf-8'));

    // Fetch profile to get email
    const profile = await gmailService.fetchProfile(oldCreds.access_token);
    const accountId = profile.email;

    // Save to new location
    await connectionManager.store.save(
      { service: 'gmail', accountId },
      {
        accessToken: oldCreds.access_token,
        refreshToken: oldCreds.refresh_token,
        expiresAt: oldCreds.expiry_date,
      }
    );

    console.log(`Migrated Gmail credentials for ${accountId}`);
  } catch (err) {
    // Migration failed (token expired, network error, etc.)
    // User will need to re-auth anyway, so just log and continue
    console.warn('Failed to migrate old Gmail credentials, user will need to reconnect:', err);
  }

  // Always delete old file - either migrated successfully or credentials were stale
  await unlink(oldGmailPath);
}
```

### Token refresh listener removal

Current code has:
```typescript
oAuth2Client.on("tokens", async (newTokens) => { ... });
```

This is removed - refresh happens in ConnectionManager.getCredentials() instead.

### Scheduler integration update

```typescript
// Before:
new TaskScheduler({ ..., gmailOAuth2Client });
new WorkflowScheduler({ ..., gmailOAuth2Client });

// After:
new TaskScheduler({ ..., connectionManager });
new WorkflowScheduler({ ..., connectionManager });
```

### SandboxAPI update

```typescript
// packages/agent/src/sandbox/api.ts

// Before:
if (this.gmailOAuth2Client) {
  addTool(global, "Gmail", "api", makeGmailTool(this.getContext, this.gmailOAuth2Client));
}

// After:
// Gmail tool always added - it checks connection status internally
addTool(global, "Gmail", "api", makeGmailTool(this.getContext, this.connectionManager));
```

### CLI update

```typescript
// apps/cli/src/commands/gmail.ts
// Update to use ConnectionManager for testing OAuth flow
// Or remove if no longer needed (server handles OAuth)
```

### Testing

- Verify OAuth flow works end-to-end
- Verify token refresh works
- Verify migration of existing gmail.json
- Verify error classification still works
- Verify multi-account works (connect second Gmail)
