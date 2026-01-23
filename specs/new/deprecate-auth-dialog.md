# Spec: Deprecate AuthDialog Component

## Problem

Per the original spec (`auth-popup-clerk-hash.md`):

> `AuthDialog.tsx` can be deleted after migration, or kept as alias:
> ```typescript
> // AuthDialog.tsx (deprecated, for backward compatibility)
> export { AuthPopup as AuthDialog } from './AuthPopup';
> ```

However, `AuthDialog.tsx` still exists as a full 368-line component with its own implementation, duplicating most of `AuthPopup.tsx`. This creates:

1. **Maintenance burden** - Two nearly identical components to maintain
2. **Confusion** - Unclear which to use
3. **Inconsistency risk** - Bug fixes might be applied to one but not the other

## Current State

- `AuthDialog.tsx` - 368 lines, full-page blocking component
- `AuthPopup.tsx` - 399 lines, modal overlay with close button

Both have nearly identical auth logic (Clerk integration, advanced mode, etc.)

## Solution

Replace `AuthDialog.tsx` contents with a re-export of `AuthPopup`:

```typescript
// AuthDialog.tsx (deprecated)
// This component is deprecated. Use AuthPopup instead.
// Kept for backward compatibility only.
export { AuthPopup as AuthDialog } from './AuthPopup';
```

**Note:** After implementing `remove-blocking-auth-from-app.md`, AuthDialog won't be used anywhere, so this is mainly for safety in case any code still references it.

## Alternative: Full Deletion

If we're confident no code uses AuthDialog after removing it from App.tsx, we can simply delete the file:

1. Search codebase for `AuthDialog` imports
2. If only App.tsx imports it, and that import is removed, delete the file
3. If other files import it, update them to use `AuthPopup` directly

## Changes

### Option A: Re-export (safer)

Replace `apps/web/src/components/AuthDialog.tsx` contents with:

```typescript
/**
 * @deprecated Use AuthPopup instead. This is kept for backward compatibility.
 * AuthPopup provides the same functionality as a dismissable modal overlay.
 */
export { AuthPopup as AuthDialog } from './AuthPopup';
```

### Option B: Delete (cleaner)

1. Remove `apps/web/src/components/AuthDialog.tsx`
2. Update any remaining imports to use `AuthPopup`

## Recommendation

Use **Option A** (re-export) initially for safety, then delete in a future cleanup once we're confident nothing uses it.

## Files to Change

1. `apps/web/src/components/AuthDialog.tsx` - Replace with re-export or delete

## Dependencies

- Should be done after `remove-blocking-auth-from-app.md` (which removes the App.tsx usage)

## Expected Outcome

- No duplicate auth component implementations
- Clear deprecation path for AuthDialog
- Single source of truth: AuthPopup

## Testing

- [ ] If re-export: Any code importing AuthDialog still works
- [ ] If delete: No TypeScript errors from missing import
- [ ] AuthPopup continues to work correctly
