# Spec: Add Token Revocation on Disconnect

## Problem

When a user disconnects a service connection, credentials are deleted locally but the OAuth token remains valid at the provider until it expires. This means:

- User cannot fully revoke access to their account
- If credentials were compromised before deletion, they remain usable
- Doesn't follow OAuth best practices for token lifecycle management

## Solution

When disconnecting a connection, attempt to revoke the token at the OAuth provider before deleting local credentials.

For Google services (Gmail, Drive, Sheets, Docs):
- Call `https://oauth2.googleapis.com/revoke?token={access_token}`

For services without revocation endpoints (e.g., Notion):
- Log that manual revocation is required
- Optionally inform the user they should revoke in provider settings

Revocation should be best-effort - continue with local cleanup even if revocation fails.

## Expected Outcome

- Tokens are revoked at the provider when user disconnects
- Compromised credentials become invalid immediately upon disconnect
- Users have proper control over their connected accounts
- Failed revocation doesn't block local cleanup

## Considerations

- File: `packages/connectors/src/manager.ts`
- Add optional `revoke` parameter to disconnect method (default true)
- Not all providers support token revocation - handle gracefully
- Log revocation failures for debugging but don't fail the disconnect
