# Spec: Fix z-index conflict for app update banner

## Problem

The app update banner in App.tsx uses `z-50`, which is the same z-index as modal dialogs (ConnectDeviceDialog, DevicesPage). If a modal opens while the banner is visible, they compete for the same layer and the banner may appear behind the modal backdrop.

## Solution

Increase the banner's z-index to ensure it always appears above modal dialogs:

- Change from `z-50` to `z-[60]` or use a semantic class like `z-[100]` for system-level notifications

## Expected Outcome

- App update banner always visible above modal dialogs
- Users can see update notification even when a modal is open

## Considerations

- Review other z-index values in the app to establish a clear layering hierarchy
- Consider creating named z-index constants for consistency (e.g., z-modal, z-notification, z-banner)
