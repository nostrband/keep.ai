# Spec: Standardize debug package version across monorepo

## Problem

The debug package has inconsistent versions across the monorepo - most packages use `^4.3.4` while apps/cli and root use `^4.4.3`.

## Solution

Update all packages to use the newer version `^4.4.3` for consistency.

## Expected Outcome

- All packages in the monorepo use the same debug version
- Consistent dependency management across the codebase
