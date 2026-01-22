# Auth: Need Auth Flag

## Summary

Add a `needAuth` flag to the `agent_state` table that indicates LLM access is unavailable. When set, the task scheduler pauses. When cleared (after successful auth), scheduler resumes.

## Detection Logic

**Need auth is true when:**
- `OPENROUTER_API_KEY` is empty, OR
- `needAuth` flag in `agent_state` is set to `true`

**First launch (for signup vs signin):**
- Both `OPENROUTER_API_KEY` AND `OPENROUTER_BASE_URL` are empty → first launch → show signup
- Otherwise → show signin

## Implementation

### 1. Agent State Table Entry

Add `needAuth` entry to `agent_state` table:

```typescript
// Key: 'needAuth'
// Value: { needed: boolean, reason?: string, timestamp?: number }
```

### 2. Set Need Auth (on auth error)

When task worker receives auth error from LLM:

```typescript
// In task worker error handling
if (isAuthError(error)) {
  await db.agentState.set('needAuth', {
    needed: true,
    reason: 'auth_error',
    timestamp: Date.now()
  });
  // Scheduler will pause when it detects this
}
```

### 3. Clear Need Auth (on successful auth)

After successful authentication:

```typescript
// In auth success handler
await db.agentState.set('needAuth', {
  needed: false,
  timestamp: Date.now()
});
```

### 4. Scheduler Integration

Scheduler checks `needAuth` before running tasks:

```typescript
// In scheduler loop
const needAuthState = await db.agentState.get('needAuth');
const config = await getConfig();

const needsAuth = !config.OPENROUTER_API_KEY || needAuthState?.needed;

if (needsAuth) {
  // Pause - don't run LLM tasks
  return;
}
```

### 5. Server-Side Monitoring

In `server.ts`, monitor `agent_state` table for changes:

```typescript
peer.on('change', (tables: string[]) => {
  if (tables.includes('agent_state')) {
    checkNeedAuth();
  }
});

async function checkNeedAuth() {
  const needAuthState = await db.agentState.get('needAuth');
  if (!needAuthState?.needed) {
    // Auth cleared, scheduler can resume
    scheduler.resume();
  }
}
```

### 6. Web Client Hook

Create `useNeedAuth` hook:

```typescript
// apps/web/src/hooks/useNeedAuth.ts
export function useNeedAuth() {
  const { api } = useDbQuery();
  const [needAuth, setNeedAuth] = useState<boolean>(false);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean>(false);

  useEffect(() => {
    // Initial check
    checkAuthState();

    // Listen for table changes
    const unsubscribe = api?.onTablesChanged((tables) => {
      if (tables.includes('agent_state')) {
        checkAuthState();
      }
    });

    return () => unsubscribe?.();
  }, [api]);

  async function checkAuthState() {
    const config = await fetch(`${API_ENDPOINT}/check_config`).then(r => r.json());
    const needAuthState = await api?.agentState.get('needAuth');

    const apiKeyEmpty = !config.OPENROUTER_API_KEY;
    const baseUrlEmpty = !config.OPENROUTER_BASE_URL;

    setIsFirstLaunch(apiKeyEmpty && baseUrlEmpty);
    setNeedAuth(apiKeyEmpty || needAuthState?.needed);
  }

  return { needAuth, isFirstLaunch };
}
```

## Files to Modify

1. **`apps/server/src/server.ts`**
   - Add `peer.on('change')` handler for `agent_state`
   - Add `checkNeedAuth` function

2. **`apps/server/src/scheduler.ts`** (or wherever scheduler lives)
   - Check `needAuth` state before running tasks
   - Pause/resume based on flag

3. **`apps/server/src/task-worker.ts`** (or wherever LLM calls happen)
   - On auth error: set `needAuth` flag in `agent_state`

4. **`apps/web/src/hooks/useNeedAuth.ts`** (new file)
   - Hook for components to check auth state

5. **Auth success handler** (wherever auth completion is handled)
   - Clear `needAuth` flag after successful auth

## Testing

- [ ] Set `needAuth` flag → scheduler pauses
- [ ] Clear `needAuth` flag → scheduler resumes
- [ ] Auth error during task → `needAuth` flag set automatically
- [ ] Successful auth → `needAuth` flag cleared
- [ ] Web client detects flag changes via table sync
