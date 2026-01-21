# Spec: Fix setTimeout cleanup in remaining components

## Problem

Several components use setTimeout without proper cleanup on unmount:
- FilesPage.tsx (upload state timeouts at lines 222, 263)
- QueryProvider.tsx (ping timeout management)

Note: App.tsx banner timeout is covered separately by specs/app-update-banner-timeout-cleanup.md

## Solution

Apply the same timeout cleanup pattern (useRef for timeout ID, useEffect cleanup on unmount, clear previous timeout before setting new one) to these components.

## Expected Outcome

- No React warnings about setting state on unmounted components
- Proper cleanup prevents memory leaks
- Consistent timeout handling across the codebase
