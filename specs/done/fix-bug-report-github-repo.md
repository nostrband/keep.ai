# Fix: Bug Report Uses Wrong GitHub Repository URL

## Source
- Review: `reviews/43d3c5a.txt`
- Commit: `43d3c5a`
- Severity: HIGH

## Problem

In `apps/web/src/lib/bugReport.ts`, the `GITHUB_REPO` constant is hardcoded to `"anthropics/keep-ai"` (line 10), but the actual repository is `"nostrband/keep.ai"` (per package.json homepage field).

All user-submitted bug reports go to the wrong repository.

## Verification

Research confirmed:
- `bugReport.ts` line 10: `GITHUB_REPO = "anthropics/keep-ai"`
- `package.json` line 52: `homepage: "https://github.com/nostrband/keep.ai"`

## Fix

```typescript
// Line 10 of bugReport.ts
const GITHUB_REPO = "nostrband/keep.ai";
```

## Files to Modify

1. `apps/web/src/lib/bugReport.ts` - Fix GITHUB_REPO constant

## Testing

- Verify bug report URL points to correct repository
- Click "Report Issue" on a notification and verify the GitHub new issue page opens for the correct repo
