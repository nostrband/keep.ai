## Connectors 06: Google Services (Sheets, Docs, Drive)

### Goal

Add Google Sheets, Google Docs, and Google Drive connectors. These share OAuth infrastructure with Gmail but have different scopes.

### Scope strategy

**Option A: Separate connections per service**
- User connects Gmail, then separately connects Drive, etc.
- More granular permissions
- More OAuth popups for user

**Option B: Combined Google connection with all scopes**
- Single "Connect Google" that requests all scopes
- User grants once, gets all Google services
- Less granular, user might not want all

**Option C: Incremental scopes (recommended)**
- Start with one service (e.g., Gmail)
- When user needs Drive, prompt to add Drive scope
- Re-auth with combined scopes, preserve existing token
- Best UX: minimal upfront permissions

For v1, implement Option A (simplest). Can optimize to Option C later.

### Service definitions

```typescript
// packages/connectors/src/services/google.ts

export const googleOAuthBase = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  extraAuthParams: {
    access_type: 'offline',
    prompt: 'consent',
  },
};

async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return response.json();
}

async function extractGoogleAccountId(tokens: OAuthCredentials, profile?: unknown) {
  return (profile as { email: string }).email;
}

// Gmail
export const gmailService: ServiceDefinition = {
  id: 'gmail',
  name: 'Gmail',
  icon: 'gmail',
  oauthConfig: {
    ...googleOAuthBase,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  extractAccountId: extractGoogleAccountId,
  fetchProfile: fetchGoogleProfile,
};

// Google Drive
export const gdriveService: ServiceDefinition = {
  id: 'gdrive',
  name: 'Google Drive',
  icon: 'gdrive',
  oauthConfig: {
    ...googleOAuthBase,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',  // Create/edit files we created
    ],
  },
  extractAccountId: extractGoogleAccountId,
  fetchProfile: fetchGoogleProfile,
};

// Google Sheets
export const gsheetsService: ServiceDefinition = {
  id: 'gsheets',
  name: 'Google Sheets',
  icon: 'gsheets',
  oauthConfig: {
    ...googleOAuthBase,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/spreadsheets',  // Read/write
    ],
  },
  extractAccountId: extractGoogleAccountId,
  fetchProfile: fetchGoogleProfile,
};

// Google Docs
export const gdocsService: ServiceDefinition = {
  id: 'gdocs',
  name: 'Google Docs',
  icon: 'gdocs',
  oauthConfig: {
    ...googleOAuthBase,
    scopes: [
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/documents',  // Read/write
    ],
  },
  extractAccountId: extractGoogleAccountId,
  fetchProfile: fetchGoogleProfile,
};
```

### Tool implementations

Each service gets its own tool file:

```typescript
// packages/agent/src/tools/gdrive.ts

import { google } from 'googleapis';
import { ConnectionManager } from '@app/connectors';

export function makeGDriveTool(
  getContext: () => Context,
  connectionManager: ConnectionManager
) {
  return async (params: {
    method: string;
    params?: Record<string, unknown>;
    account: string;  // REQUIRED
  }) => {
    const creds = await getConnectionCredentials(connectionManager, 'gdrive', params.account);
    const drive = google.drive({ version: 'v3', auth: createOAuthClient(creds) });

    // Supported methods:
    // - files.list: List files/folders
    // - files.get: Get file metadata
    // - files.export: Export Google Docs/Sheets to other formats
    // - files.create: Upload file
    // - files.update: Update file
    // ... route to appropriate method
  };
}
```

```typescript
// packages/agent/src/tools/gsheets.ts

export function makeGSheetsTool(
  getContext: () => Context,
  connectionManager: ConnectionManager
) {
  return async (params: {
    method: string;
    params?: Record<string, unknown>;
    account: string;  // REQUIRED
  }) => {
    const creds = await getConnectionCredentials(connectionManager, 'gsheets', params.account);
    const sheets = google.sheets({ version: 'v4', auth: createOAuthClient(creds) });

    // Supported methods:
    // - spreadsheets.get: Get spreadsheet metadata
    // - spreadsheets.values.get: Read cell values
    // - spreadsheets.values.update: Write cell values
    // - spreadsheets.values.append: Append rows
    // - spreadsheets.batchUpdate: Complex updates
  };
}
```

```typescript
// packages/agent/src/tools/gdocs.ts

export function makeGDocsTool(
  getContext: () => Context,
  connectionManager: ConnectionManager
) {
  return async (params: {
    method: string;
    params?: Record<string, unknown>;
    account: string;  // REQUIRED
  }) => {
    const creds = await getConnectionCredentials(connectionManager, 'gdocs', params.account);
    const docs = google.docs({ version: 'v1', auth: createOAuthClient(creds) });

    // Supported methods:
    // - documents.get: Get document content
    // - documents.batchUpdate: Insert/delete/format text
  };
}
```

### Shared helper

```typescript
// packages/agent/src/tools/google-common.ts

import { google } from 'googleapis';

export async function getConnectionCredentials(
  connectionManager: ConnectionManager,
  service: string,
  accountId: string  // REQUIRED - no default account
): Promise<OAuthCredentials> {
  if (!accountId) {
    const connections = await connectionManager.listConnectionsByService(service);
    if (connections.length === 0) {
      throw new AuthError(`${service} not connected. Please connect in Settings.`, { source: service });
    }
    throw new LogicError(
      `${service} account required. Available accounts: ${connections.map(c => c.id.accountId).join(', ')}`
    );
  }

  return connectionManager.getCredentials({ service, accountId });
}

export function createOAuthClient(creds: OAuthCredentials) {
  const client = new google.auth.OAuth2();
  client.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt,
  });
  return client;
}
```

### OAuth client ID

All Google services share the same OAuth client ID - just different scopes. Register all redirect URIs in Google Cloud Console:
- `http://localhost:PORT/api/connectors/gmail/callback`
- `http://localhost:PORT/api/connectors/gdrive/callback`
- `http://localhost:PORT/api/connectors/gsheets/callback`
- `http://localhost:PORT/api/connectors/gdocs/callback`

### Environment variables

Single secret for all Google services:
```
GOOGLE_CLIENT_ID=642393276548-...
GOOGLE_CLIENT_SECRET=...
```

Or keep existing `GMAIL_SECRET` and use for all Google services.

### Sandbox registration

```typescript
// packages/agent/src/sandbox/api.ts

// Add all Google tools
addTool(global, "Gmail", "api", makeGmailTool(ctx, connectionManager));
addTool(global, "GoogleDrive", "api", makeGDriveTool(ctx, connectionManager));
addTool(global, "GoogleSheets", "api", makeGSheetsTool(ctx, connectionManager));
addTool(global, "GoogleDocs", "api", makeGDocsTool(ctx, connectionManager));
```

### UI grouping

In Connections UI, group Google services:
```
Google
├── Gmail: user@gmail.com (Connected)
├── Drive: user@gmail.com (Connected)
├── Sheets: Not connected [+ Connect]
└── Docs: Not connected [+ Connect]
```

### TBD

- Incremental scope expansion (Option C)
- Unified "Connect Google" that asks which services
- Scope overlap handling (Drive includes Sheets/Docs file access)
