# Spec: Fix Windows Case-Sensitivity Bypass in Electron File Protocol Handler

## Problem

The Electron app's path traversal protection uses JavaScript string comparison (`startsWith`) to validate that resolved paths are within the allowed public/ directory. However, on Windows:

- Filesystems are case-insensitive (`PUBLIC` and `public` refer to the same directory)
- JavaScript string comparison is case-sensitive

This mismatch allows an attacker to bypass validation:
```
allowedBaseDir = "C:\Users\App\public"
resolvedPath   = "C:\Users\App\PUBLIC\file.html"

resolvedPath.startsWith(allowedBaseDir + "\")  // false (case mismatch)
// But Windows filesystem would allow access to the same directory
```

## Solution

Normalize both paths to lowercase on Windows before performing the prefix validation check:

```javascript
if (process.platform === 'win32') {
  resolvedPath = resolvedPath.toLowerCase();
  allowedBaseDir = allowedBaseDir.toLowerCase();
}
```

## Expected Outcome

- Case variations cannot bypass path validation on Windows
- No change in behavior on Unix/macOS (case-sensitive filesystems)
- Valid paths continue to work regardless of case

## Considerations

- Could be combined with the symlink vulnerability fix (specs/new/electron-symlink-vulnerability-fix.md) in a single security hardening commit
