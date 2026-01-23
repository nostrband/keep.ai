## Connectors 01: Core Package

### Goal

Create `packages/connectors` with foundational types, OAuth flow handler, and file-based credential storage. This is the foundation all service integrations build on.

### Package structure

```
packages/connectors/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # Public exports
    ├── types.ts           # Core type definitions
    ├── oauth.ts           # Generic OAuth2 flow handler
    ├── store.ts           # File-based credential storage
    └── services/          # Service-specific implementations (later specs)
```

### Types (`types.ts`)

```typescript
// Identifies a specific connection (service + account)
export interface ConnectionId {
  service: string;        // e.g., "gmail", "notion"
  accountId: string;      // e.g., email address or user ID
}

// OAuth2 URL/scope configuration (static per service)
// clientId and clientSecret come from build-time secrets, not here
export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  // Optional: some services need extra params
  extraAuthParams?: Record<string, string>;
}

// Stored credentials
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;     // Unix timestamp ms
  scope?: string;
  tokenType?: string;
  // Service-specific data (e.g., email for Google)
  metadata?: Record<string, unknown>;
}

// Connection status
export type ConnectionStatus =
  | "connected"           // Credentials exist and valid
  | "expired"             // Token expired, needs refresh
  | "error"               // Auth error, needs reconnect
  | "disconnected";       // No credentials

// Full connection record
export interface Connection {
  id: ConnectionId;
  status: ConnectionStatus;
  credentials?: OAuthCredentials;
  createdAt: number;
  lastUsedAt?: number;
  label?: string;         // User-friendly name, e.g., "Work Gmail"
}

// Result of OAuth callback
export interface OAuthCallbackResult {
  success: boolean;
  connection?: Connection;
  error?: string;
}

// Service definition (implemented by each service)
export interface ServiceDefinition {
  id: string;             // e.g., "gmail"
  name: string;           // e.g., "Gmail"
  icon?: string;          // Icon name or URL
  oauthConfig: Omit<OAuthConfig, 'clientId' | 'clientSecret'>;
  // Extract account ID from tokens/profile
  extractAccountId: (tokens: OAuthCredentials, profile?: unknown) => Promise<string>;
  // Optional: fetch user profile after auth
  fetchProfile?: (accessToken: string) => Promise<unknown>;
}
```

### OAuth flow (`oauth.ts`)

```typescript
export class OAuthHandler {
  constructor(
    private config: OAuthConfig,
    private clientId: string,           // From build-time secrets
    private clientSecret: string,       // From build-time secrets
    private redirectUri: string
  ) {}

  // Generate authorization URL
  getAuthUrl(state?: string): string {
    // Build URL with clientId, redirectUri, config.scopes, state
    // Include config.extraAuthParams if present
  }

  // Exchange code for tokens
  async exchangeCode(code: string): Promise<OAuthCredentials> {
    // POST to config.tokenUrl with code, clientId, clientSecret, redirectUri
    // Return normalized credentials
  }

  // Refresh access token
  async refreshToken(refreshToken: string): Promise<OAuthCredentials> {
    // POST to config.tokenUrl with refresh_token, clientId, clientSecret
    // Return new credentials (preserve refresh_token if not returned)
  }
}
```

### Credential storage (`store.ts`)

```typescript
export class CredentialStore {
  constructor(private basePath: string) {}

  // File path: {basePath}/connectors/{service}/{accountId}.json
  private getFilePath(id: ConnectionId): string;

  // Save credentials (mode 0o600)
  async save(id: ConnectionId, credentials: OAuthCredentials): Promise<void>;

  // Load credentials
  async load(id: ConnectionId): Promise<OAuthCredentials | null>;

  // Delete credentials
  async delete(id: ConnectionId): Promise<void>;

  // List all connections for a service
  async listByService(service: string): Promise<ConnectionId[]>;

  // List all connections
  async listAll(): Promise<ConnectionId[]>;
}
```

### File structure

Credentials stored as:
```
{userPath}/connectors/
├── gmail/
│   ├── user@gmail.com.json
│   └── work@company.com.json
├── notion/
│   └── user-abc123.json
└── gdrive/
    └── user@gmail.com.json
```

Each JSON file contains `OAuthCredentials` with metadata.

### Error types

Extend existing error classification:
```typescript
// In packages/agent/src/errors.ts, add:
export function classifyOAuthError(err: unknown, service: string): ClassifiedError {
  // Map common OAuth errors to AuthError
  // - invalid_grant
  // - Token has been expired or revoked
  // - invalid_token
  // - access_denied
}
```

### Migration

Existing `{userPath}/gmail.json` should be migrated to new location on first load:
- Check if old file exists
- Move to `{userPath}/connectors/gmail/{accountId}.json`
- Delete old file

### Dependencies

```json
{
  "name": "@app/connectors",
  "dependencies": {
    // Minimal - just what's needed for OAuth HTTP calls
  }
}
```

**NOT dependencies of this package:**
- `@app/db` - database access is injected, not imported (see spec 02)
- Service SDKs (googleapis, @notionhq/client) - imported by tools in `@app/agent`, not here

This keeps `@app/connectors` focused on OAuth mechanics and portable/testable.

### TBD

- Encryption of stored credentials (future: OS keystore)
- Connection health check mechanism
- Token refresh scheduling vs on-demand
