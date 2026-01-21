# Spec: Debug Mode Toggle in Settings

## Problem

Once the web application is built for production, there's no way to enable debug output without rebuilding. This makes production debugging difficult when investigating user-reported issues.

## Solution

Add a debug mode toggle in the web app settings screen that enables verbose debug output when activated.

## Expected Outcome

- A toggle switch in the settings screen to enable/disable debug mode
- When enabled, debug output appears in the browser console
- Setting persists across sessions (localStorage)
- Works in production builds without requiring a rebuild

## Considerations

- Consider adding a visual indicator when debug mode is active
- May want to require multiple clicks or a hidden gesture to access (to avoid confusion for regular users)
