# Auth: Popup with Clerk Hash Routes

## Summary

Refactor `AuthDialog` into a dismissable popup component (`AuthPopup`) that works as a modal overlay. Configure Clerk to use hash-based routes (`/#/signup`, `/#/signin`) so its internal navigation links work correctly in Electron.

## Current State

- `AuthDialog` is a full-page blocking component
- Clerk uses `routing="hash"` but `signUpUrl="/signup"` points to non-existent route
- No way to dismiss the auth UI

## Target State

- `AuthPopup` is a modal overlay on the current page
- Can be dismissed via close button or clicking backdrop
- Clerk's `signUpUrl="/#/signup"` and `signInUrl="/#/signin"` work via hash routing
- `mode` prop controls which form to show initially

## Implementation

### 1. AuthPopup Component

```typescript
// apps/web/src/components/AuthPopup.tsx
interface AuthPopupProps {
  mode: 'signin' | 'signup';
  onAuthenticated: () => void;
  onClose: () => void;
  clerkPublishableKey?: string;
}

export function AuthPopup({ mode, onAuthenticated, onClose, clerkPublishableKey }: AuthPopupProps) {
  const [currentMode, setCurrentMode] = useState(mode);

  // Listen for hash changes to switch mode
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#/signup') {
        setCurrentMode('signup');
      } else if (window.location.hash === '#/signin') {
        setCurrentMode('signin');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Clear hash on close
  const handleClose = () => {
    if (window.location.hash.startsWith('#/sign')) {
      history.replaceState(null, '', window.location.pathname);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600"
        >
          <XIcon className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="p-6">
          <ClerkAuthProvider clerkPublishableKey={clerkPublishableKey}>
            <AuthContent
              mode={currentMode}
              onAuthenticated={onAuthenticated}
              clerkPublishableKey={clerkPublishableKey}
            />
          </ClerkAuthProvider>
        </div>
      </div>
    </div>
  );
}
```

### 2. Clerk URL Configuration

Update Clerk components to use hash-based URLs:

```typescript
// In AuthContent (moved from AuthDialog)
<SignIn
  routing="hash"
  signUpUrl="/#/signup"  // Changed from "/signup"
/>

<SignUp
  routing="hash"
  signInUrl="/#/signin"  // Changed from "/signin"
/>
```

### 3. Hash Route Handling

When Clerk navigates to `/#/signup` or `/#/signin`:

1. Hash change event fires
2. `AuthPopup` detects hash change
3. Updates `currentMode` to show correct form
4. Clerk's internal form is already correct (it uses hash routing internally)

### 4. Remove Manual Toggle

Since Clerk's internal links now work, remove the manual toggle button:

```typescript
// REMOVE this from the component:
<button onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
  {authMode === 'signin' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
</button>
```

Keep the "Use your own OpenRouter API key" link for advanced mode.

### 5. Preserve Advanced Mode

Keep the advanced mode (manual API key entry) accessible:

```typescript
<div className="mt-4 text-center">
  <button
    type="button"
    className="text-sm text-gray-600 hover:text-gray-500"
    onClick={() => setCurrentMode('advanced')}
  >
    Use your own OpenRouter API key
  </button>
</div>
```

### 6. Auth Success Handler

On successful auth, clear hash and call callback:

```typescript
const handleAuthSuccess = () => {
  // Clear any auth hash
  if (window.location.hash.startsWith('#/sign')) {
    history.replaceState(null, '', window.location.pathname);
  }
  onAuthenticated();
};
```

## Migration from AuthDialog

1. Copy content from `AuthDialog.tsx` to new `AuthPopup.tsx`
2. Remove full-page wrapper (`min-h-screen`, etc.)
3. Add modal wrapper with backdrop
4. Add close button and `onClose` prop
5. Update Clerk URLs to hash-based
6. Remove manual signin/signup toggle
7. Keep advanced mode option

`AuthDialog.tsx` can be deleted after migration, or kept as alias:

```typescript
// AuthDialog.tsx (deprecated, for backward compatibility)
export { AuthPopup as AuthDialog } from './AuthPopup';
```

## Files to Change

1. **`apps/web/src/components/AuthPopup.tsx`** (new file)
   - Modal popup version of auth UI

2. **`apps/web/src/components/AuthDialog.tsx`**
   - Delete or re-export from AuthPopup

3. **`apps/web/src/App.tsx`**
   - Remove blocking auth rendering (no longer needed)

## Edge Cases

1. **User on `/#/signup` but opens popup with signin mode**
   - Hash takes precedence, shows signup

2. **User navigates away while popup open**
   - Popup should close, or persist? (Recommend: close)

3. **Electron HashRouter interaction**
   - App already uses HashRouter for Electron
   - Auth hashes (`#/signup`) coexist with app routes (`#/workflows`)
   - Need to ensure no conflicts

4. **Deep linking to `/#/signup`**
   - Should work: hash detected, popup opens

## Testing

- [ ] Popup opens as modal overlay
- [ ] Click backdrop → popup closes
- [ ] Click X button → popup closes
- [ ] Clerk "Sign up" link → switches to signup form (hash changes)
- [ ] Clerk "Sign in" link → switches to signin form (hash changes)
- [ ] Complete auth → popup closes, hash cleared
- [ ] "Use your own OpenRouter API key" → shows advanced form
- [ ] Works in Electron (HashRouter mode)
- [ ] No conflicts with app HashRouter routes
