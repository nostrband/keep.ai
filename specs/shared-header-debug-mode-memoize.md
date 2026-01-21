# Spec: Memoize debug mode check in SharedHeader

## Problem

SharedHeader reads localStorage synchronously on every render to check debug mode status. Since SharedHeader renders on every page, this causes unnecessary synchronous blocking on every render.

## Solution

Memoize the debug mode value using useState or a reusable hook so localStorage is only read once on mount.

## Expected Outcome

- localStorage is read only once when the component mounts, not on every render
- Debug badge still displays correctly when debug mode is enabled
