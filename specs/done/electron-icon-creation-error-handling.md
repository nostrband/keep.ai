# Spec: Add error handling to electron icon creation

## Problem

In `apps/electron/src/main.ts`, the `getAppIcon()` function creates a fallback SVG icon using `nativeImage.createFromDataURL()`. This call is not wrapped in try-catch, so if it fails (e.g., invalid base64 encoding), it throws an unhandled exception that could crash the handler using the icon.

## Solution

Wrap the SVG icon creation in a try-catch block. On failure, log the error and return an empty NativeImage as a safe fallback.

## Expected Outcome

- `getAppIcon()` never throws, always returns a valid NativeImage (possibly empty)
- Errors during icon creation are logged for debugging
- App continues to function even if icon creation fails

## Considerations

- An empty icon is acceptable as a last resort - the app remains functional
- The file-based icon loading already has error handling, only the SVG fallback needs it
