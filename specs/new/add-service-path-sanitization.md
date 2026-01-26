# Spec: Add Service Parameter Path Sanitization

## Problem

The `id.service` parameter is used in file paths when storing credentials. While service registration provides some protection (only registered services can be used), there's no direct path traversal prevention as defense-in-depth.

A malicious or buggy service ID like `../../../etc` could potentially escape the intended directory.

## Solution

Add sanitization to strip any characters that could enable path traversal. Only allow alphanumeric characters, underscores, and hyphens in service IDs.

Example: `id.service.replace(/[^a-z0-9_-]/gi, '')`

## Expected Outcome

- Service IDs containing path traversal characters are sanitized
- Defense-in-depth protection even if service registration is bypassed
- No change to legitimate service IDs (gmail, gdrive, gsheets, gdocs, notion)

## Considerations

- File: `packages/connectors/src/store.ts`
- Could also add validation at service registration time
- Consider throwing an error vs silently sanitizing for security visibility
