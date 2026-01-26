# Spec: Fix OAuth State Management Vulnerabilities

## Problem

The OAuth pending states management has several security issues:

1. **Unbounded state map growth**: Attacker can repeatedly call `startOAuthFlow()` without completing, filling memory with pending states. The lazy cleanup only runs on new flow starts, so an attacker who stops after creating many states leaves them in memory.

2. **Missing redirectUri re-validation**: The stored redirectUri is trusted in `completeOAuthFlow` without re-validation against allowed URIs.

3. **State TTL too long**: 10-minute TTL is excessive for OAuth flow. Standard practice is 5 minutes or less - longer window means more attack opportunity.

## Solution

1. Add hard limit on pending states (e.g., 100 max). When limit reached, remove oldest entry.
2. Add periodic cleanup timer as backup (e.g., every 60 seconds).
3. Re-validate redirectUri against whitelist in `completeOAuthFlow`.
4. Reduce state TTL to 5 minutes.

## Expected Outcome

- Memory exhaustion DoS via pending states is prevented
- Stale states are cleaned up even without new OAuth flow starts
- RedirectUri is validated at both flow start and completion
- Reduced attack window with shorter TTL

## Considerations

- File: `packages/connectors/src/manager.ts`
- Related spec: `fix-oauth-state-race-condition.md` (atomic state consumption)
- Cleanup timer should be cleared on manager shutdown
- Consider logging when limit is reached for monitoring
