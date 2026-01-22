# Spec: Add error handling for localStorage access

## Problem

localStorage access can fail in private/incognito browsing mode, when storage quota is exceeded, or when localStorage is disabled. The debug mode feature reads localStorage without try-catch, which could cause errors in these scenarios.

## Solution

Wrap localStorage access in try-catch blocks to handle failures gracefully, defaulting to safe fallback values when access fails.

## Expected Outcome

- App doesn't crash when localStorage is unavailable
- Debug mode gracefully defaults to disabled when localStorage access fails
- No console errors in private/incognito mode

## Considerations

- This pattern should be applied consistently wherever localStorage is used in the codebase
- Consider creating a utility function for safe localStorage access if this pattern is needed in multiple places
