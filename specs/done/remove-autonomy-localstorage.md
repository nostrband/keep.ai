# Spec: Remove localStorage from Autonomy Preference

## Problem
The `useAutonomyPreference` hook uses localStorage for persistence, but this is redundant. The `api.setAutonomyMode()` already writes to a local in-browser database cache that syncs to the backend. Having two storage mechanisms (localStorage + db cache) can lead to sync issues.

## Solution
Remove localStorage usage from the hook and rely solely on the API/db cache for persistence.

## Expected Outcome
- Autonomy preference stored only in the database (via API)
- No localStorage keys created for autonomy preference
- Preference still persists correctly across page refreshes
- Eliminates potential sync issues between localStorage and db
