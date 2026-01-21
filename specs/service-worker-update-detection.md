# Spec: Fix service worker update detection race condition

## Problem

In main.tsx, the app update banner triggers on the service worker's `activated` state, but this is unreliable:

```typescript
if (newWorker.state === "activated") {
  if (navigator.serviceWorker.controller) {
    window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
  }
}
```

Issues:
- `activated` fires when the SW reaches activated state
- The controller might still be the OLD worker at this moment
- The `controllerchange` event fires AFTER `activated`

This causes:
- False positives: Banner fires on first install
- False negatives: Banner misses legitimate updates

## Solution

Listen to the `controllerchange` event instead of checking state in `statechange`:

```typescript
navigator.serviceWorker.addEventListener('controllerchange', () => {
  window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
});
```

The `controllerchange` event fires exactly when the new service worker takes control, which is the correct trigger point for notifying the user.

## Expected Outcome

- Banner only shows when an actual update takes control
- No false positive on first install
- Reliable detection of service worker updates

## Considerations

- `controllerchange` may fire multiple times in edge cases - consider deduplication
- Coordinate with existing `handleControllerChange` in QueryProviderEmbedded.tsx
- Test both first install and update scenarios
