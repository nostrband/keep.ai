# Auth: Header Notice

## Summary

Show an icon/notice in the header when `needAuth` flag is set. This provides persistent visibility that auth is needed, regardless of which page the user is on.

## Behavior

1. `needAuth` flag is set (no API key or auth error)
2. Header shows warning icon with optional tooltip/text
3. Clicking the icon opens auth popup (or navigates to settings)
4. After successful auth, icon disappears

## Design Options

### Option A: Icon Only (Minimal)

Small warning icon in header, tooltip on hover:

```
[K] Keep.AI                              [⚠️] [Settings]
```

Tooltip: "AI access unavailable. Click to sign in."

### Option B: Icon + Text (More Visible)

Icon with short text:

```
[K] Keep.AI                    [⚠️ Sign in required] [Settings]
```

### Option C: Banner (Most Visible)

Full-width banner below header:

```
[K] Keep.AI                                         [Settings]
─────────────────────────────────────────────────────────────
⚠️ AI access unavailable. [Sign in] to continue.
```

**Recommendation:** Option B - visible but not intrusive.

## Implementation

### 1. Header Auth Notice Component

```typescript
// apps/web/src/components/HeaderAuthNotice.tsx
interface HeaderAuthNoticeProps {
  isFirstLaunch: boolean;
  onClick: () => void;
}

export function HeaderAuthNotice({ isFirstLaunch, onClick }: HeaderAuthNoticeProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 text-sm text-yellow-700 bg-yellow-100 hover:bg-yellow-200 rounded-md transition-colors"
    >
      <AlertTriangleIcon className="w-4 h-4" />
      <span>{isFirstLaunch ? "Sign up" : "Sign in"}</span>
    </button>
  );
}
```

### 2. Integration in SharedHeader

```typescript
// In SharedHeader.tsx
const { needAuth, isFirstLaunch } = useNeedAuth();
const [showAuthPopup, setShowAuthPopup] = useState(false);

return (
  <header className="...">
    {/* Logo and nav */}

    <div className="flex items-center gap-2">
      {needAuth && (
        <HeaderAuthNotice
          isFirstLaunch={isFirstLaunch}
          onClick={() => setShowAuthPopup(true)}
        />
      )}
      {/* Other header items */}
    </div>

    {/* Auth popup */}
    {showAuthPopup && (
      <AuthPopup
        mode={isFirstLaunch ? 'signup' : 'signin'}
        onAuthenticated={() => setShowAuthPopup(false)}
        onClose={() => setShowAuthPopup(false)}
      />
    )}
  </header>
);
```

### 3. Popup vs Navigation

Two approaches when user clicks header notice:

**Option A: Open popup directly**
- Popup overlays current page
- Less context switching

**Option B: Navigate to auth page**
- Go to `/#/signup` or `/#/signin`
- Full-page auth experience

**Recommendation:** Option A (popup) for consistency with chat page behavior.

## Visual States

| State | Header Shows |
|-------|-------------|
| First launch, no creds | Yellow "Sign up" button |
| Returning user, need auth | Yellow "Sign in" button |
| Valid creds | Nothing (normal header) |

## Files to Modify

1. **`apps/web/src/components/HeaderAuthNotice.tsx`** (new file)
   - Notice/button component

2. **`apps/web/src/components/SharedHeader.tsx`**
   - Integrate `useNeedAuth` hook
   - Add `HeaderAuthNotice` component
   - Add auth popup state

## Dependencies

- Requires `useNeedAuth` hook from `auth-need-auth-flag` spec
- Requires `AuthPopup` component from `auth-popup-clerk-hash` spec

## Testing

- [ ] `needAuth` true → header shows notice
- [ ] First launch → notice says "Sign up"
- [ ] Returning user with stale creds → notice says "Sign in"
- [ ] Click notice → auth popup opens
- [ ] Complete auth → notice disappears
- [ ] Notice visible on all pages (MainPage, WorkflowsPage, etc.)
