# Spec: Implement Tray Menu IPC Handlers

## Problem
The Electron tray menu has "New automation..." and "Pause all automations" menu items that send IPC messages (`focus-input` and `pause-all-automations`). The preload script exposes listeners for these events, but no React component actually registers handlers. The menu items don't do anything.

Additionally, the current preload pattern for these listeners doesn't return an unsubscribe function. Each call adds a new listener, so if a React component mounts/unmounts multiple times, listeners accumulate causing memory leaks and duplicate handler executions.

## Desired Behavior
- "New automation..." should navigate to the main page and focus the prompt input field
- "Pause all automations" should pause all currently active workflows
- IPC listener registration should return a cleanup function so React components can properly unsubscribe on unmount

## Expected Outcome
- Both tray menu items function as intended
- Preload IPC listener pattern supports proper cleanup
- No memory leaks from component mount/unmount cycles
