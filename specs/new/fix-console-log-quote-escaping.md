# Spec: Fix Console-Log Quote Escaping

## Problem

The `consoleLogTool` wraps log messages in single quotes but doesn't escape single quotes within the message content. This creates malformed output:

- Input: `"It's a test with 'nested quotes'"`
- Output: `'It's a test with 'nested quotes''`

The unescaped quotes can break log parsing or cause display issues.

## Solution

Add proper escaping for quotes in log messages. Options:

1. Escape single quotes within the message (replace `'` with `\'`)
2. Switch to double quotes and escape double quotes
3. Use JSON.stringify() for proper escaping of all special characters
4. Use template literals with backticks

## Expected Outcome

- Log messages with embedded quotes are properly escaped
- Log output is valid and parseable
- Special characters in messages don't break formatting

## Considerations

- File: `packages/agent/src/tools/console-log.ts`
- JSON.stringify() would be most robust but changes output format
- Simple escape replacement maintains current format with minimal change
- Update existing tests to verify proper escaping behavior
