# Spec: Fix Check Endpoint HTTP Status Codes

## Problem

The `/connectors/:service/:accountId/check` endpoint returns HTTP 200 even when the connection check fails. This violates HTTP semantics where success status codes should only be used for successful operations.

Clients cannot rely on status codes to determine success/failure and must parse the response body.

## Solution

Return appropriate HTTP status codes based on the failure type:
- 401 for authentication errors (expired/invalid tokens)
- 503 for service unavailable (external API down)
- 500 for other internal errors

Keep 200 only for successful connection checks.

## Expected Outcome

- HTTP status codes accurately reflect operation outcome
- Clients can use status codes for error handling
- Follows REST API best practices

## Considerations

- File: `apps/server/src/routes/connectors.ts`
- Check if any client code relies on current 200-always behavior
- Response body should still include error details for 4xx/5xx responses
