# Auth: Chat Event Item and Popup

## Summary

When `needAuth` is true and user is on `/chats/:id` page, show an auth event item in the chat interface. Clicking it opens the auth popup. The popup is dismissable.

## Behavior

1. User is on `/chats/:id` page
2. `needAuth` flag is set (no API key or auth error occurred)
3. Chat interface shows "Need authentication" event item
4. User clicks event item → auth popup opens
5. Popup can be dismissed (closes without completing auth)
6. Event item remains visible until auth is successful

## Implementation

### 1. Auth Event Item Component

```typescript
// apps/web/src/components/AuthEventItem.tsx
interface AuthEventItemProps {
  isFirstLaunch: boolean;
  onAuthClick: () => void;
}

export function AuthEventItem({ isFirstLaunch, onAuthClick }: AuthEventItemProps) {
  return (
    <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
      <WarningIcon className="text-yellow-600" />
      <div className="flex-1">
        <p className="text-sm font-medium text-yellow-800">
          {isFirstLaunch
            ? "Sign up to access AI"
            : "Authentication required"}
        </p>
        <p className="text-xs text-yellow-600">
          {isFirstLaunch
            ? "Get free daily credits to run your automations"
            : "Please sign in again to continue"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onAuthClick}
      >
        {isFirstLaunch ? "Sign up" : "Sign in"}
      </Button>
    </div>
  );
}
```

### 2. Auth Popup State in Chat Interface

```typescript
// In ChatDetailPage or ChatInterface component
const { needAuth, isFirstLaunch } = useNeedAuth();
const [showAuthPopup, setShowAuthPopup] = useState(false);

// Auto-show popup when needAuth becomes true (optional, or rely on event item click)
useEffect(() => {
  if (needAuth) {
    setShowAuthPopup(true);
  }
}, [needAuth]);

return (
  <>
    {/* Chat messages */}
    {needAuth && (
      <AuthEventItem
        isFirstLaunch={isFirstLaunch}
        onAuthClick={() => setShowAuthPopup(true)}
      />
    )}

    {/* Auth popup */}
    {showAuthPopup && (
      <AuthPopup
        mode={isFirstLaunch ? 'signup' : 'signin'}
        onAuthenticated={() => setShowAuthPopup(false)}
        onClose={() => setShowAuthPopup(false)}
      />
    )}
  </>
);
```

### 3. Event Item Placement

The auth event item should appear:
- At the bottom of the chat message list (most recent position)
- Or as a sticky element at the bottom of the chat area
- Visually distinct from regular chat messages

### 4. Popup Auto-Show vs Click-to-Show

Two options:

**Option A: Auto-show on page load**
- When user navigates to `/chats/:id` and `needAuth` is true, popup shows immediately
- User can dismiss, event item remains for re-opening

**Option B: Click-to-show only**
- Popup only opens when user clicks the event item
- Less intrusive

Recommend: **Option A** for first occurrence, then click-to-show after dismissal.

```typescript
const [hasAutoDismissed, setHasAutoDismissed] = useState(false);

useEffect(() => {
  if (needAuth && !hasAutoDismissed) {
    setShowAuthPopup(true);
  }
}, [needAuth, hasAutoDismissed]);

const handleDismiss = () => {
  setShowAuthPopup(false);
  setHasAutoDismissed(true);
};
```

## Files to Modify

1. **`apps/web/src/components/AuthEventItem.tsx`** (new file)
   - Event item component

2. **`apps/web/src/components/ChatDetailPage.tsx`** or **`ChatInterface.tsx`**
   - Integrate `useNeedAuth` hook
   - Add auth event item rendering
   - Add auth popup state and rendering

## Dependencies

- Requires `useNeedAuth` hook from `auth-need-auth-flag` spec
- Requires `AuthPopup` component from `auth-popup-clerk-hash` spec

## Testing

- [ ] Navigate to `/chats/:id` with `needAuth` true → popup auto-shows
- [ ] Dismiss popup → event item visible, popup closed
- [ ] Click event item → popup reopens
- [ ] Complete auth → event item disappears, popup closes
- [ ] First launch shows "Sign up", returning user shows "Sign in"
