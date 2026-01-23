# Spec: Fix Proactive needAuth Detection

## Problem

The `useNeedAuth` hook only reads the `need_auth` flag from the database, which is only set **reactively** when:
- LLM returns 401 auth error
- LLM returns 402 payment required error

Per the original spec (`auth-need-auth-flag.md`), `needAuth` should also be `true` **proactively** when:
- `OPENROUTER_API_KEY` is empty

Additionally, `isFirstLaunch` should be determined by checking if BOTH `OPENROUTER_API_KEY` AND `OPENROUTER_BASE_URL` are empty.

Currently, neither of these proactive checks exist.

## Current Implementation

`useNeedAuth` hook only does:
```typescript
const needAuthState = await api.getNeedAuth();
setState(needAuthState);
```

It doesn't check config at all.

## Solution

Update `useNeedAuth` to:
1. Check config validity via `/check_config` endpoint
2. Set `needAuth = true` if API key is missing (even if db flag is false)
3. Determine `isFirstLaunch` based on both API key AND base URL being empty

## Changes

### 1. Update useNeedAuth.ts

```typescript
export function useNeedAuth() {
  const { api, dbStatus } = useDbQuery();
  const [state, setState] = useState<NeedAuthState>({ needed: false });
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadState = useCallback(async () => {
    if (!api || dbStatus !== 'ready') return;

    try {
      // Check database flag
      const needAuthState = await api.getNeedAuth();

      // Also check config to detect missing API key proactively
      const configResponse = await fetch(`${API_ENDPOINT}/check_config`);
      const configData = await configResponse.json();

      // Determine if auth is needed:
      // - Database flag says so (auth/payment error occurred), OR
      // - Config is invalid (API key missing)
      const authNeeded = needAuthState.needed || configData.ok === false;

      // Determine if first launch:
      // - Both API key AND base URL are empty (never configured)
      const firstLaunch = !configData.hasApiKey && !configData.hasBaseUrl;

      setState({
        needed: authNeeded,
        reason: needAuthState.reason || (configData.ok === false ? 'api_key_missing' : undefined),
        timestamp: needAuthState.timestamp,
      });
      setIsFirstLaunch(firstLaunch);
      setIsLoaded(true);
    } catch (error) {
      console.warn('Could not load needAuth state:', error);
      setIsLoaded(true);
    }
  }, [api, dbStatus]);

  // ... rest of hook

  return {
    needAuth: state.needed,
    reason: state.reason,
    timestamp: state.timestamp,
    isFirstLaunch,
    isLoaded,
    clearNeedAuth,
    refresh: loadState,
  };
}
```

### 2. Update /check_config endpoint to return more details

In `apps/server/src/server.ts`, update the `/check_config` response:

```typescript
app.get('/check_config', async (req, reply) => {
  const apiKey = getEnv().OPENROUTER_API_KEY;
  const baseUrl = getEnv().OPENROUTER_BASE_URL;

  return reply.send({
    ok: !!apiKey,
    hasApiKey: !!apiKey,
    hasBaseUrl: !!baseUrl,
  });
});
```

### 3. Remove duplicate config checking from HeaderAuthNotice and AuthEventItem

These components currently use both `useNeedAuth` AND `useConfig`:

```typescript
const { needAuth, reason, isLoaded: needAuthLoaded } = useNeedAuth();
const { isConfigValid, isLoading: configLoading } = useConfig();

const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);
```

After this fix, they can simplify to:

```typescript
const { needAuth, isFirstLaunch, isLoaded } = useNeedAuth();

const shouldShow = isLoaded && needAuth;
```

## Expected Outcome

- `needAuth` is `true` immediately on app startup if API key is missing
- No need to wait for an LLM call to fail before showing auth prompt
- `isFirstLaunch` correctly distinguishes new users (show "Sign up") from returning users with expired auth (show "Sign in")
- Removes need for `useConfig` in auth-related components

## Testing

- [ ] Fresh install with no config → `needAuth = true`, `isFirstLaunch = true`
- [ ] Has API key but it expired (401 error) → `needAuth = true`, `isFirstLaunch = false`
- [ ] Has valid API key → `needAuth = false`
- [ ] HeaderAuthNotice shows correct text ("Sign up" vs "Sign in")
- [ ] AuthEventItem shows correct text
