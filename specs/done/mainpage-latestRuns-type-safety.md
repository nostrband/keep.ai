# Spec: Fix type safety for latestRuns in MainPage

## Problem

MainPage.tsx uses `useState<Record<string, any>>({})` for the latestRuns state, losing TypeScript type safety. This bypasses compile-time type checking for ScriptRun properties.

## Solution

Import and use the proper `ScriptRun` type instead of `any`.

## Expected Outcome

- Full TypeScript type checking for latestRuns state
- IDE autocomplete and error detection for ScriptRun properties
- Catches type mismatches at compile time
