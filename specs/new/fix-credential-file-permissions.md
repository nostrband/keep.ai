# Spec: Fix Credential File Permission Validation

## Problem

The credential store sets `mode: 0o600` when writing files, but this has limitations:

1. Only applies on file creation - if file already exists with looser permissions (e.g., 0o644), they may not be updated
2. System umask can affect actual permissions set
3. No verification that permissions were applied correctly
4. If permissions are wrong, credentials become readable by other users

## Solution

1. Write to a temp file first, then atomic rename (also addresses crash safety)
2. Verify permissions after write with `fs.stat()`
3. Force correct permissions with `fs.chmod()` if needed
4. Fail with clear error if permissions cannot be set correctly
5. Add startup audit to check and fix permissions on existing credential files

## Expected Outcome

- Credential files always have 0o600 permissions regardless of existing file state or umask
- Permissions are verified after every write operation
- Clear error if secure permissions cannot be established
- Existing files with wrong permissions are automatically fixed on startup

## Considerations

- File: `packages/connectors/src/store.ts`
- Atomic write (temp file + rename) also prevents credential corruption on crash
- Consider also checking parent directory permissions (should be 0o700)
- Log warnings when permissions need to be fixed for security visibility
