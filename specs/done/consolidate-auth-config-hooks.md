# Spec: Consolidate Auth and Config Hooks

## Problem

There are two overlapping hooks for checking auth/config state:

1. **`useConfig`** - Checks `/check_config` endpoint, returns `isConfigValid`
2. **`useNeedAuth`** - Reads `need_auth` from database, returns `needAuth`

Components like `HeaderAuthNotice` and `AuthEventItem` use BOTH:

```typescript
const { needAuth, reason, isLoaded: needAuthLoaded } = useNeedAuth();
const { isConfigValid, isLoading: configLoading } = useConfig();

const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);
```

This is confusing, redundant, and leads to race conditions and inconsistent behavior.

## Solution

After implementing `fix-proactive-needauth-detection.md`, `useNeedAuth` will handle both database flags AND config validity. At that point:

1. Remove `useConfig` hook entirely
2. Update all consumers to use only `useNeedAuth`

## Changes

### 1. Delete useConfig.ts

Remove `apps/web/src/hooks/useConfig.ts`

### 2. Update imports in affected files

**HeaderAuthNotice.tsx:**
```diff
- import { useNeedAuth } from "../hooks/useNeedAuth";
- import { useConfig } from "../hooks/useConfig";
+ import { useNeedAuth } from "../hooks/useNeedAuth";

export function HeaderAuthNotice({ className = "" }: HeaderAuthNoticeProps) {
-  const { needAuth, reason, isLoaded: needAuthLoaded, refresh: refreshNeedAuth } = useNeedAuth();
-  const { isConfigValid, isLoading: configLoading, recheckConfig } = useConfig();
+  const { needAuth, isFirstLaunch, isLoaded, refresh } = useNeedAuth();

-  const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);
+  const shouldShow = isLoaded && needAuth;

  const getButtonText = () => {
-    if (reason === 'api_key_missing' || isConfigValid === false) {
-      return 'Sign up';
-    }
-    return 'Sign in';
+    return isFirstLaunch ? 'Sign up' : 'Sign in';
  };

  const handleAuthenticated = () => {
    setShowAuthPopup(false);
-    recheckConfig();
-    refreshNeedAuth();
+    refresh();
  };
```

**AuthEventItem.tsx:**
```diff
- import { useNeedAuth } from "../hooks/useNeedAuth";
- import { useConfig } from "../hooks/useConfig";
+ import { useNeedAuth } from "../hooks/useNeedAuth";

export function AuthEventItem({ autoShowPopup = true }: AuthEventItemProps) {
-  const { needAuth, reason, isLoaded: needAuthLoaded, refresh: refreshNeedAuth } = useNeedAuth();
-  const { isConfigValid, isLoading: configLoading, recheckConfig } = useConfig();
+  const { needAuth, isFirstLaunch, isLoaded, refresh } = useNeedAuth();

-  const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);
+  const shouldShow = isLoaded && needAuth;

-  const isFirstLaunch = reason === 'api_key_missing' || isConfigValid === false;
+  // isFirstLaunch now comes from useNeedAuth

  const handleAuthenticated = () => {
    setShowAuthPopup(false);
    setHasAutoDismissed(true);
-    recheckConfig();
-    refreshNeedAuth();
+    refresh();
  };
```

### 3. Remove useConfig from App.tsx (if not already done)

Per `remove-blocking-auth-from-app.md`, App.tsx should no longer use `useConfig`.

## Files to Change

1. Delete `apps/web/src/hooks/useConfig.ts`
2. Update `apps/web/src/components/HeaderAuthNotice.tsx`
3. Update `apps/web/src/components/AuthEventItem.tsx`
4. Update `apps/web/src/App.tsx` (remove import if still present)

## Dependencies

- Must implement `fix-proactive-needauth-detection.md` first
- Must implement `remove-blocking-auth-from-app.md` first

## Expected Outcome

- Single source of truth for auth state (`useNeedAuth`)
- Simpler, more consistent code in auth components
- No race conditions between two different config checks
- Cleaner API: `needAuth`, `isFirstLaunch`, `isLoaded`, `refresh`

## Testing

- [ ] HeaderAuthNotice works correctly with only useNeedAuth
- [ ] AuthEventItem works correctly with only useNeedAuth
- [ ] No TypeScript errors from removed useConfig
- [ ] Fresh install shows "Sign up"
- [ ] Returning user with expired auth shows "Sign in"
