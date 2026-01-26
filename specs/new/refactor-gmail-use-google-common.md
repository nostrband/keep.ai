# Spec: Refactor Gmail Tool to Use google-common.ts

## Problem

The Gmail tool has inline credential fetching and OAuth client creation logic, while the other Google tools (gdrive, gsheets, gdocs) use shared utilities from `google-common.ts`. This creates code duplication and inconsistent patterns.

Gmail duplicates:
- Account validation logic (could use `getGoogleCredentials()`)
- OAuth client creation (could use `createGoogleOAuthClient()`)

## Solution

Refactor the Gmail tool to use the shared utilities from google-common.ts:
- Replace inline account validation and credential fetching with `getGoogleCredentials()`
- Replace inline OAuth2 client creation with `createGoogleOAuthClient()`

## Expected Outcome

- Gmail tool uses same patterns as gdrive, gsheets, and gdocs
- Reduced code duplication
- Easier maintenance - changes to credential handling only need to happen in one place

## Considerations

- File: `packages/agent/src/tools/gmail.ts`
- Shared utilities: `packages/agent/src/tools/google-common.ts`
