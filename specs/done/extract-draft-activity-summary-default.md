# Spec: Extract DraftActivitySummary Default Constant

## Problem

In `dbScriptReads.ts`, the fallback object for `DraftActivitySummary` is duplicated in two places (lines 294-298 and 302-306). If the interface changes, both must be updated manually, which is error-prone.

## Solution

Extract the fallback to a shared constant that both usages reference.

## Expected Outcome

- Single source of truth for default DraftActivitySummary values
- Adding new fields to the interface only requires updating one location

## Considerations

- File involved: apps/web/src/hooks/dbScriptReads.ts
