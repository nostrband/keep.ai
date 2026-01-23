# Header: Show Server Error Instead of Sign Up

## Summary

When the server is down, the header shows a "Sign up" button which is incorrect. It should show "Server error" or similar message (only when not in serverless mode).

## Current Behavior

In `HeaderAuthNotice.tsx` lines 22-32:
```typescript
// Determine if we need to show the notice
const shouldShow = needAuthLoaded && !configLoading && (needAuth || isConfigValid === false);

// Determine the button text based on state
const getButtonText = () => {
  if (reason === 'api_key_missing' || isConfigValid === false) {
    // First launch or no API key configured
    return 'Sign up';
  }
  // Returning user needs to re-authenticate
  return 'Sign in';
};
```

The problem is that when the server is down:
1. `useConfig()` fetch fails and sets `isConfigValid = false`
2. `isConfigValid === false` triggers the "Sign up" button
3. User sees "Sign up" but the real issue is server connectivity

## Root Cause

In `useConfig.ts` lines 32-38:
```typescript
} catch (error) {
  setState({
    isConfigValid: false,  // Set to false on error
    isLoading: false,
    error: error instanceof Error ? error.message : 'Failed to check configuration',
  });
}
```

The `useConfig` hook doesn't distinguish between "config invalid" and "server unreachable". Both result in `isConfigValid = false`.

## Required Changes

### Option A: Detect Server Error in useConfig

**File: `apps/web/src/hooks/useConfig.ts`**

Add a separate state for server error:
```typescript
interface ConfigState {
  isConfigValid: boolean | null;
  isLoading: boolean;
  error: string | null;
  isServerError: boolean;  // New field
}

// In catch block:
} catch (error) {
  setState({
    isConfigValid: null,  // Unknown, not false
    isLoading: false,
    error: error instanceof Error ? error.message : 'Failed to check configuration',
    isServerError: true,  // Server is unreachable
  });
}
```

### Option B: Check Error in HeaderAuthNotice

**File: `apps/web/src/components/HeaderAuthNotice.tsx`**

```typescript
const { isConfigValid, isLoading: configLoading, error: configError, recheckConfig } = useConfig();

const getButtonText = () => {
  // Check for server error first (only in non-serverless mode)
  if (configError && !__SERVERLESS__) {
    return 'Server error';
  }
  if (reason === 'api_key_missing' || isConfigValid === false) {
    return 'Sign up';
  }
  return 'Sign in';
};

// Also update click behavior - don't show auth popup for server errors
const handleClick = () => {
  if (configError && !__SERVERLESS__) {
    // Maybe show a different modal or just do nothing
    // Or try to recheck config
    recheckConfig();
    return;
  }
  setShowAuthPopup(true);
};
```

Also need to add the `__SERVERLESS__` check:
```typescript
declare const __SERVERLESS__: boolean;
```

### Recommended Approach: Combine Both

1. Make `useConfig` track server errors explicitly
2. Update `HeaderAuthNotice` to handle server error case differently

**File: `apps/web/src/hooks/useConfig.ts`**
```typescript
interface ConfigState {
  isConfigValid: boolean | null;
  isLoading: boolean;
  error: string | null;
  isServerError: boolean;
}

// Initial state
const [state, setState] = useState<ConfigState>({
  isConfigValid: null,
  isLoading: true,
  error: null,
  isServerError: false,
});

// Success case
setState({
  isConfigValid: data.ok === true,
  isLoading: false,
  error: null,
  isServerError: false,
});

// Error case
setState({
  isConfigValid: null,
  isLoading: false,
  error: error instanceof Error ? error.message : 'Failed to check configuration',
  isServerError: true,
});
```

**File: `apps/web/src/components/HeaderAuthNotice.tsx`**
```typescript
declare const __SERVERLESS__: boolean;

// In component:
const { isConfigValid, isLoading: configLoading, isServerError, recheckConfig } = useConfig();

// Updated shouldShow - show for server errors in non-serverless mode
const shouldShow = needAuthLoaded && !configLoading && (
  needAuth ||
  isConfigValid === false ||
  (isServerError && !__SERVERLESS__)
);

const getButtonText = () => {
  if (isServerError && !__SERVERLESS__) {
    return 'Server error';
  }
  if (reason === 'api_key_missing' || isConfigValid === false) {
    return 'Sign up';
  }
  return 'Sign in';
};

// Update button styling for server error (red instead of amber)
const buttonClass = isServerError && !__SERVERLESS__
  ? "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
  : "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors";
```

## Files to Modify

1. **`apps/web/src/hooks/useConfig.ts`**
   - Add `isServerError` to state
   - Set it to `true` when fetch fails
   - Set it to `false` on successful fetch

2. **`apps/web/src/components/HeaderAuthNotice.tsx`**
   - Import/declare `__SERVERLESS__`
   - Check `isServerError` before showing "Sign up"
   - Show "Server error" with different styling when server is down
   - Optionally: clicking "Server error" retries the config check

## Testing

- [ ] Server running, no API key: shows "Sign up"
- [ ] Server running, API key expired: shows "Sign in"
- [ ] Server down, non-serverless mode: shows "Server error" (red)
- [ ] Server down, serverless mode: no notice shown (or appropriate message)
- [ ] Server comes back up: notice updates appropriately
- [ ] Clicking "Server error" retries config check
