# Spec: Fix Account ID Encoding Collision

## Problem

The account ID encoding for file paths uses `encodeURIComponent().replace(/%/g, "_")` which is lossy. Different account IDs can map to the same encoded value:

- `user@example.com` → `user_40example.com`
- `user%40example.com` → `user_40example.com`

This could cause credential collision where one account's credentials overwrite another's.

## Solution

Use a reversible, collision-free encoding for account IDs. Options:

1. URL-safe base64 encoding (base64url)
2. Hex encoding
3. Double-encode (encode the % signs first, then other characters)

URL-safe base64 is compact and widely supported.

## Expected Outcome

- Each unique account ID maps to a unique encoded filename
- No credential collisions possible
- Encoding is reversible if needed for debugging

## Considerations

- File: `packages/connectors/src/store.ts`
- Migration: existing credentials use old encoding scheme
- May need migration logic or support for both encodings during transition
