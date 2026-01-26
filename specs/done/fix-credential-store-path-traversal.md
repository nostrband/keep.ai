# Spec: Fix Credential Store Path Traversal Vulnerability

## Problem

The `getFilePath` method in CredentialStore uses insufficient sanitization for account IDs. A malicious accountId like `../../../etc/passwd` could enable path traversal attacks, allowing credentials to be written to arbitrary filesystem locations.

Current encoding:
```typescript
const safeAccountId = encodeURIComponent(id.accountId).replace(/%/g, "_");
```

After encoding `../../../etc/passwd` becomes `.._2F.._2F.._2Fetc_2Fpasswd` which still contains `..` that `path.join` doesn't protect against.

## Solution

Use a secure, non-reversible encoding for account IDs that prevents path traversal:

Option 1: Use crypto hash (SHA-256) of the accountId for filenames
Option 2: Strict whitelist validation that rejects any path-like characters

Additionally, validate the resolved path stays within the intended directory.

## Expected Outcome

- Path traversal attacks are impossible regardless of accountId content
- Credentials can only be written to the designated connectors directory
- Clear error thrown for invalid account IDs rather than silent sanitization

## Considerations

- Files: `packages/connectors/src/store.ts`
- Related specs: `fix-account-id-encoding.md`, `add-service-path-sanitization.md`
- If using hash-based filenames, consider storing original accountId in file content for debugging
- Migration needed for existing credential files
