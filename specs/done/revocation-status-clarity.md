# Spec: Clarify Token Revocation Status Return Values

## Problem

The `revokeToken()` method in oauth.ts returns `true` when no revoke URL is configured:

```typescript
if (!this.config.revokeUrl) {
  return true; // Not an error, just not supported
}
```

Downstream code in manager.ts then logs misleadingly:

```typescript
if (revoked) {
  debug("Token revoked at provider for %s", connectionId); // Misleading!
}
```

This makes debugging and auditing difficult because logs indicate successful revocation when none actually occurred.

## Solution

Change the return type to include the reason for the result:

```typescript
type RevokeResult = {
  success: boolean;
  reason: 'revoked' | 'not_supported' | 'failed';
};
```

Update the calling code in manager.ts to log appropriately based on the reason.

## Expected Outcome

- Logs accurately reflect what happened (actual revocation vs not supported vs failure)
- Easier debugging and auditing of token lifecycle
- Clear distinction between "revocation succeeded" and "revocation not applicable"

## Considerations

- Update all callers of revokeToken() to handle the new return type
- Consider whether 'not_supported' should be logged at all, or just silently succeed
