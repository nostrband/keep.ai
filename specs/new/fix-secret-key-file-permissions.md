# Spec: Fix Secret Key File Permissions

## Problem

In `ensureEnv()`, the users.json file containing secret keys is created with default permissions (0644 on Unix), making it world-readable. Secret keys should not be accessible to other users on the system.

## Solution

Set restrictive file permissions (0600) when writing users.json, so only the owner can read/write the file.

## Expected Outcome

- users.json file has 0600 permissions (owner read/write only)
- Secret keys are not readable by other users on the system

## Considerations

- May need to handle Windows differently (different permission model)
- Consider also checking/fixing permissions on existing files during startup
