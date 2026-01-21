# Spec: Extract useAutoHidingMessage hook

## Problem

The success/warning message pattern with timeout cleanup is duplicated across 4+ files:
- WorkflowEventGroup.tsx
- ScriptDetailPage.tsx
- TaskDetailPage.tsx
- WorkflowDetailPage.tsx

Each file has ~25 lines of similar code for:
- useState for message state
- useRef for timeout tracking
- useEffect for cleanup on unmount
- showSuccessMessage/showWarning helper functions

Total: ~100 lines of duplicated code.

## Solution

Extract a reusable `useAutoHidingMessage` hook that encapsulates the message state, timeout refs, cleanup effect, and helper functions.

## Expected Outcome

- Single source of truth for auto-hiding message logic
- Each component just imports and uses the hook
- Consistent timeout durations and behavior across components
- Reduced code duplication
