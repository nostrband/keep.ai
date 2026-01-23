## Connectors 00: OAuth Client Credentials

### Goal

Bundle OAuth client credentials (client ID + secret) into the app at build time, with optional runtime override for power users.

### Context: Desktop OAuth Apps

This is a desktop Electron app registered as "Desktop App" type with OAuth providers (Google, Notion). For desktop/mobile apps:
- Client secrets are considered **public** (can't be hidden from users)
- OAuth providers know this and security relies on redirect URI validation, not secret secrecy
- Standard practice: embed credentials in app binary

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BUILD TIME                           │
│                                                             │
│  secrets.build.json ──► esbuild define ──► bundled consts   │
│  (gitignored)           (compile time)     (in binary)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        RUNTIME                              │
│                                                             │
│  Bundled defaults ◄── getOAuthCredentials() ──► User        │
│  (most users)          (checks override)        override    │
│                                                 (power      │
│                                                  users)     │
└─────────────────────────────────────────────────────────────┘
```

### Build-time: secrets.build.json

Developer creates `secrets.build.json` in project root (gitignored):

```json
{
  "GOOGLE_CLIENT_ID": "642393276548-xxx.apps.googleusercontent.com",
  "GOOGLE_CLIENT_SECRET": "GOCSPX-xxx",
  "NOTION_CLIENT_ID": "xxx",
  "NOTION_CLIENT_SECRET": "secret_xxx"
}
```

### Build-time: Injection

The project uses tsup (wrapper around esbuild). Current pattern in `apps/server/tsup.config.ts`:

```typescript
// Current approach - env vars at build time
define: {
  "process.env.GMAIL_SECRET": JSON.stringify(process.env.BUILD_GMAIL_SECRET),
}
```

**Updated approach** - load from secrets.build.json with env var fallback:

```typescript
// apps/server/tsup.config.ts
import fs from 'fs';
import path from 'path';

function loadBuildSecrets(): Record<string, string> {
  const secretsPath = path.join(process.cwd(), '../../secrets.build.json');

  if (fs.existsSync(secretsPath)) {
    return JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
  }

  // Fallback to env vars (for CI)
  return {};
}

const secrets = loadBuildSecrets();

// Helper: use secrets.build.json value, fall back to env var
const getSecret = (key: string, envKey?: string): string => {
  return secrets[key] || process.env[envKey || `BUILD_${key}`] || '';
};

export default defineConfig({
  // ...
  define: {
    "process.env.GOOGLE_CLIENT_ID": JSON.stringify(getSecret('GOOGLE_CLIENT_ID')),
    "process.env.GOOGLE_CLIENT_SECRET": JSON.stringify(getSecret('GOOGLE_CLIENT_SECRET', 'BUILD_GMAIL_SECRET')),
    "process.env.NOTION_CLIENT_ID": JSON.stringify(getSecret('NOTION_CLIENT_ID')),
    "process.env.NOTION_CLIENT_SECRET": JSON.stringify(getSecret('NOTION_CLIENT_SECRET')),
  },
});
```

This maintains the existing `process.env.NAME` convention while adding file-based secrets support.

### Runtime: Bundled credentials

```typescript
// packages/connectors/src/credentials.ts

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

// process.env values are replaced at build time by tsup define
export function getGoogleCredentials(): OAuthAppCredentials {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  };
}

export function getNotionCredentials(): OAuthAppCredentials {
  return {
    clientId: process.env.NOTION_CLIENT_ID || '',
    clientSecret: process.env.NOTION_CLIENT_SECRET || '',
  };
}
```

### Usage in ConnectionManager

```typescript
// packages/connectors/src/manager.ts

import { getGoogleCredentials, getNotionCredentials } from './credentials';

export class ConnectionManager {
  private getCredentialsForService(service: string): OAuthAppCredentials {
    switch (service) {
      case 'gmail':
      case 'gdrive':
      case 'gsheets':
      case 'gdocs':
        return getGoogleCredentials();
      case 'notion':
        return getNotionCredentials();
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  // Used when creating OAuthHandler
  startOAuthFlow(service: string, redirectUri: string) {
    const { clientId, clientSecret } = this.getCredentialsForService(service);
    const handler = new OAuthHandler({
      ...this.services.get(service)!.oauthConfig,
      clientId,
      clientSecret,
    }, redirectUri);
    // ...
  }
}
```

### Files in repo

```
project/
├── secrets.build.json          # Actual secrets (GITIGNORED)
├── secrets.build.example.json  # Template (committed)
├── .gitignore                  # includes secrets.build.json
```

**secrets.build.example.json** (committed):
```json
{
  "_comment": "Copy to secrets.build.json and fill in values from Google/Notion developer console",
  "GOOGLE_CLIENT_ID": "",
  "GOOGLE_CLIENT_SECRET": "",
  "NOTION_CLIENT_ID": "",
  "NOTION_CLIENT_SECRET": ""
}
```

### .gitignore additions

```gitignore
# OAuth app credentials (build-time)
secrets.build.json
```

### CI/CD

In CI, create `secrets.build.json` from environment/secrets:

```yaml
# GitHub Actions example
- name: Create secrets file
  run: |
    cat > secrets.build.json << EOF
    {
      "GOOGLE_CLIENT_ID": "${{ secrets.GOOGLE_CLIENT_ID }}",
      "GOOGLE_CLIENT_SECRET": "${{ secrets.GOOGLE_CLIENT_SECRET }}",
      "NOTION_CLIENT_ID": "${{ secrets.NOTION_CLIENT_ID }}",
      "NOTION_CLIENT_SECRET": "${{ secrets.NOTION_CLIENT_SECRET }}"
    }
    EOF
```

### Migration from current approach

Current: `GMAIL_SECRET` env var at build time, hardcoded `CLIENT_ID` in code.

Steps:
1. Create `secrets.build.json` with current values
2. Update esbuild configs to inject via `define`
3. Replace hardcoded `CLIENT_ID` with `__GOOGLE_CLIENT_ID__`
4. Replace `process.env.GMAIL_SECRET` with `__GOOGLE_CLIENT_SECRET__`
5. Add runtime override support

### Security notes

- Client secrets in desktop apps are public by design - OAuth providers know this
- Bundling in binary is safer than separate file (harder to accidentally leak)
- Override file is for power users who understand the implications

### How redirect URI validation protects desktop OAuth

**The problem:** Client secret is embedded in app binary → anyone can extract it.

**Why it's still secure:** OAuth providers validate the redirect URI.

**How it works:**

1. **Registration** (one-time, in provider console):
   - Google Cloud Console → Credentials → OAuth Client → Authorized redirect URIs
   - Notion Developer Portal → Integration → OAuth settings → Redirect URIs
   - You register exactly which URIs can receive auth codes:
     ```
     http://127.0.0.1:4681/api/connectors/gmail/callback
     http://localhost:4681/api/connectors/gmail/callback
     ```

2. **OAuth flow:**
   ```
   App sends:     redirect_uri=http://127.0.0.1:4681/api/connectors/gmail/callback
   Google checks: Is this URI in registered list?
                  YES → proceed with OAuth
                  NO  → reject with "redirect_uri_mismatch" error
   ```

3. **After user approves:**
   ```
   Google redirects to: http://127.0.0.1:4681/api/connectors/gmail/callback?code=AUTH_CODE
   Only our app (listening on that port) receives the code.
   ```

**Attack scenario - why it fails:**

```
Attacker has: client_id + client_secret (extracted from our binary)
Attacker wants: User's OAuth tokens

Attacker tries:
  redirect_uri=https://evil.com/steal-token

Google says:
  "Error: redirect_uri_mismatch"
  (evil.com not in registered URIs)

Attacker tries:
  redirect_uri=http://127.0.0.1:4681/...  (our registered URI)

Google redirects to:
  http://127.0.0.1:4681/...?code=AUTH_CODE

But attacker isn't running on user's localhost:4681
→ Our app receives the code, not attacker
```

**For desktop apps:** The redirect goes to `localhost` which only the local app can receive. Attacker would need to:
- Run malware on user's machine
- Bind to exact same port before our app does
- At that point they have bigger problems than OAuth

**Alternative: Custom protocol schemes:**
```
keepai://oauth/callback
```
Registered as URI handler by Electron app - even harder to intercept.
