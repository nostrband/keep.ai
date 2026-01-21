# Spec: Fix ElectronNavigationHandler Memory Leak

## Problem

The ElectronNavigationHandler component in App.tsx has incorrect useEffect dependencies and cleanup:

1. `navigate` from `useNavigate()` returns a new function reference on each render
2. Having `navigate` in the dependency array causes the effect to run on every render
3. Each run adds a new IPC listener
4. `removeAllListeners('navigate-to')` removes ALL listeners, not just this component's
5. Result: memory leak and multiple navigation handlers executing per event

## Solution

Use a ref to stabilize the navigate callback and use an empty dependency array so the effect only runs once on mount.

## Expected Outcome

- IPC listener registered only once on component mount
- Proper cleanup removes only this component's listener
- No memory leak from accumulated listeners
- Single navigation per IPC event

## Considerations

- Use `useRef` to hold the navigate function reference
- Update ref on each render so it always has current navigate
- Effect callback uses ref.current to access stable reference
