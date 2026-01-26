# Spec: Fix Token Refresh Race Condition

## Problem

Multiple concurrent `getCredentials()` calls for the same connection can trigger duplicate token refresh requests. When an access token is expired, each concurrent call independently detects this and attempts to refresh.

OAuth providers may:
- Invalidate the refresh token on concurrent refresh attempts
- Rate limit refresh requests
- Return different tokens to each request, causing inconsistent state

This can cause service disruption and authentication failures.

## Solution

Add an in-memory lock/mutex per connection ID to serialize refresh requests. When a refresh is in progress, other callers should wait for it to complete rather than initiating their own refresh.

Approach:
- Maintain a Map of pending refresh Promises keyed by connection ID
- If a refresh is already in progress for a connection, await the existing Promise
- Only one refresh request per connection can be in-flight at a time

## Expected Outcome

- Only one token refresh request is made per connection, even under concurrent load
- Other callers wait for and receive the result of the in-progress refresh
- No token invalidation from concurrent refresh attempts
- No rate limiting issues from duplicate refresh requests

## Considerations

- File: `packages/connectors/src/manager.ts`
- Pattern: `refreshPromises: Map<string, Promise<OAuthCredentials>>`
- Need to handle refresh failures (clear the promise so retry is possible)
- Connection ID key format: `${service}:${accountId}`
