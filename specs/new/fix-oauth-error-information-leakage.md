# Spec: Fix OAuth Error Information Leakage

## Problem

OAuth error messages are propagated directly to the client without sanitization. Full error details from OAuth providers can leak sensitive internal information:

- Client IDs: `"invalid_client: The OAuth client was not found. Client ID: 12345-abcdef..."`
- Redirect URI mismatches: `"redirect_uri_mismatch: http://localhost:4681 vs http://127.0.0.1:4681"`
- Internal endpoints: `"Error fetching profile from https://internal-api.company.com/userinfo"`

This gives attackers information about internal configuration and infrastructure.

## Solution

Sanitize OAuth errors before returning to client:

1. Map known OAuth error codes to generic user-friendly messages
2. Never expose raw error details from OAuth providers
3. Log full error details server-side for debugging
4. Return generic fallback message for unknown errors

Example mapping:
- `invalid_grant` → "Authorization expired or invalid. Please try again."
- `invalid_client` → "OAuth configuration error. Please contact support."
- `access_denied` → "Access was denied. Please try again and approve all permissions."

## Expected Outcome

- No internal configuration details leaked to clients
- Users see helpful, actionable error messages
- Full error details available in server logs for debugging
- Attackers cannot enumerate OAuth configuration

## Considerations

- Files: `packages/connectors/src/manager.ts`, `packages/connectors/src/oauth.ts`
- OAuthError class should store error code only, not full response body
- Consider different message detail levels for dev vs production
