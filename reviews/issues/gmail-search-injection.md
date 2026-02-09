# Pending Issue: Gmail Search Injection Vulnerability

## Source
- Review: `reviews/114589d.txt`
- Issue #6 (HIGH severity)
- File: `packages/agent/src/reconciliation/gmail-reconcile.ts` (line 94)

## Problem

Idempotency key is directly interpolated into Gmail search query:

```typescript
const searchQuery = `in:sent "${idempotencyKey}"`;
```

If idempotency key contains Gmail search operators or quotes (e.g., `test" OR subject:password`), it could:
- Alter search semantics
- Cause reconciliation to match wrong messages
- Potentially disclose information from other emails

## Research Findings

### Current Risk: LOW (Theoretical)

1. **Gmail send tool doesn't exist yet** - The reconciliation code is ready but waiting for send tool implementation
2. **Idempotency keys are internally managed** - Not currently user-controllable
3. **Test cases use safe values** - Simple strings like `"key-123"`

### Future Risk: MEDIUM-HIGH

When Gmail send tool is implemented:
- If idempotency keys incorporate user data (subject, body hash, etc.)
- If workflow variables flow into idempotency keys
- Risk becomes real

## Proposed Fix (From Review)

```typescript
const safeKey = idempotencyKey.replace(/["\\]/g, '\\$&');
const searchQuery = `in:sent "${safeKey}"`;
```

## Better Long-term Solution

1. Generate idempotency keys as UUIDs (no special characters)
2. Embed in `X-Keep-Idempotency` custom header instead of message body
3. Search by header: `header:X-Keep-Idempotency:${uuid}`
4. Add validation to reject keys containing `"` or `\`

## Questions for User

1. Should we fix this proactively before Gmail send tool exists?
2. Should we document idempotency key format requirements instead?
3. Is there a planned timeline for Gmail send tool implementation?

## Recommendation

- **If v1 will include Gmail send**: Fix now (Priority 1)
- **If Gmail send is post-v1**: Document requirements and defer (Priority 2)

## Status

RESOLVED - Deferred. Gmail send tool doesn't exist yet and idempotency keys will be internally generated (UUIDs per reconciliation spec). Fix proactively when send tool is implemented. No action needed for v1.
