# Spec: Fix MIME Detection Fallback in fileUtils.ts

## Problem

In `storeFileData()`, the filename-based MIME detection fallback is unreachable:

```typescript
mediaType = await detectBufferMime(fileBuffer);

if (!mediaType && filename && filename !== "unknown") {
  mediaType = detectFilenameMime(filename);  // NEVER REACHED
}
```

`detectBufferMime()` always returns a string - either the detected type or 'application/octet-stream' as a fallback. The condition `!mediaType` is therefore always false.

Impact: Files without magic bytes (text files, JSON, CSS, XML, etc.) are incorrectly assigned 'application/octet-stream' even when the filename clearly indicates the correct MIME type.

Note: mimeUtils.ts already has a correct `detectMime()` function that properly implements two-step fallback.

## Solution

Change the condition to check for the generic fallback type instead of falsy:

```typescript
mediaType = await detectBufferMime(fileBuffer);

if (mediaType === 'application/octet-stream' && filename && filename !== "unknown") {
  const filenameMime = detectFilenameMime(filename);
  if (filenameMime !== 'application/octet-stream') {
    mediaType = filenameMime;
  }
}
```

Alternatively, use the existing `detectMime()` from mimeUtils.ts which already handles this correctly.

## Expected Outcome

- Files with recognizable extensions (`.json`, `.css`, `.txt`, etc.) get correct MIME types
- Buffer-based detection still takes priority for files with magic bytes
- Filename detection acts as proper fallback for text-based formats

## Considerations

- Update tests that document the bug as "expected behavior"
- Consider whether to refactor to use the existing detectMime() function for consistency
