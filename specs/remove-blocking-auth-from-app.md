# Spec: Remove Blocking Auth from App.tsx

## Problem

App.tsx blocks the entire application when `isConfigValid === false` by rendering a full-page `AuthDialog`:

```tsx
// App.tsx lines 288-297
if (isConfigValid === false) {
  return (
    <ClerkAuthProvider clerkPublishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthDialog
        onAuthenticated={recheckConfig}
        clerkPublishableKey={CLERK_PUBLISHABLE_KEY}
      />
    </ClerkAuthProvider>
  );
}
```

This contradicts the intended UX from the auth specs which say:
- Users should be able to use the app freely
- Auth popup should appear as a dismissable modal when LLM is needed
- `HeaderAuthNotice` and `AuthEventItem` should handle auth prompts

Because App.tsx blocks everything, `HeaderAuthNotice` (in SharedHeader) and `AuthEventItem` (in ChatInterface) never get a chance to render.

## Solution

Remove the blocking auth check from App.tsx. Let the app render normally and rely on:
1. `HeaderAuthNotice` - Shows "Sign up" / "Sign in" button in header
2. `AuthEventItem` - Shows auth card in chat interface with auto-popup on first occurrence

## Changes

### 1. Remove blocking auth section from App.tsx

Delete or comment out lines 270-298:

```tsx
// DELETE THIS ENTIRE BLOCK:
// For non-serverless mode, check configuration first
if (!isServerless) {
  if (configLoading) {
    return (...);
  }
  if (configError) {
    return (...);
  }
  if (isConfigValid === false) {
    return (
      <ClerkAuthProvider ...>
        <AuthDialog ... />
      </ClerkAuthProvider>
    );
  }
}
```

### 2. Remove useConfig import and usage from App.tsx

Since we're no longer blocking on config validity:
- Remove `import { useConfig } from "./hooks/useConfig";`
- Remove `const { isConfigValid, isLoading: configLoading, error: configError, recheckConfig } = useConfig();`

### 3. Keep AuthDialog for backward compatibility

`AuthDialog.tsx` can remain as-is for now since `AuthPopup` is used by the non-blocking components. A future cleanup can remove or alias it.

## Expected Outcome

- App renders normally even without valid API key configuration
- Users see the main page and can browse the app
- `HeaderAuthNotice` shows "Sign up" button in header when auth is needed
- When user navigates to chat, `AuthEventItem` shows with auto-popup
- User can dismiss popup and continue exploring
- Auth is only required when actually trying to run LLM operations

## Dependencies

- Requires `useNeedAuth` to work properly (see `fix-proactive-needauth-detection.md`)
- `HeaderAuthNotice` and `AuthEventItem` are already integrated in SharedHeader and ChatInterface

## Testing

- [ ] App loads without blocking when no API key is configured
- [ ] User can navigate to all pages without auth
- [ ] HeaderAuthNotice shows "Sign up" button in header
- [ ] AuthEventItem shows in chat interface
- [ ] Clicking either opens AuthPopup as dismissable modal
- [ ] After auth, notice disappears and app works normally
