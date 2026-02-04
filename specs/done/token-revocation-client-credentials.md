# Spec: Add Client Credentials to Token Revocation Request

## Problem

In oauth.ts, the token revocation request only includes the access token:

```typescript
const body = new URLSearchParams({
  token: accessToken,
  // Missing: client_id, client_secret
});
```

However, the token exchange request (line 77-78) correctly includes both `client_id` and `client_secret`. Google's revocation endpoint accepts client credentials for additional security verification.

## Solution

Add `client_id` and `client_secret` to the token revocation request body, matching the pattern used in token exchange.

## Expected Outcome

- Token revocation requests include client credentials
- Consistent authentication pattern between token exchange and revocation
- More secure revocation that verifies the client is authorized to revoke the token

## Considerations

- Verify Google's revocation endpoint documentation for required/optional parameters
- Other OAuth providers may have different requirements - ensure the implementation works for all configured providers
