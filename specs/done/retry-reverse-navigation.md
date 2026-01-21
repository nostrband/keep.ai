# Spec: Retry Reverse Navigation

## Problem
When viewing a retry run, users can see a link to the original failed run. However, when viewing the original failed run, there's no way to see what retries occurred after it. Users must scroll through the run list manually to find retries.

## Desired Behavior
When viewing a failed run that has been retried, users should be able to see and navigate to the retry attempts that followed. This completes the bidirectional navigation of retry chains.

## Why This Matters
- Users investigating failures want to see the full retry history
- Helps users understand if retries eventually succeeded
- Saves time vs manually scanning through run list
- Makes the retry lineage feature complete from UX perspective

## Files likely involved
- `apps/web/src/components/ScriptRunDetailPage.tsx` - display retries
- `packages/db/src/script-store.ts` - may need query method
