# Spec: Add Called Callback to Fix Tool Factory

## Problem

`checkIfFixToolCalled` inspects AI SDK message parts looking for `part.type === "tool-fix"`. This is fragile because:
- Relies on SDK internal representation that may change
- Could silently fail if SDK changes format

## Solution

The fix tool factory method should accept a callback (like the save tool already does) that is invoked when the tool is called. This callback can set a 'called' flag that the caller can check instead of inspecting message parts.

Pattern to follow (from save tool):
```typescript
makeFixTool({
  // ... other options
  onCalled: (result) => { fixWasCalled = true; }
})
```

## Expected Outcome

- No need to inspect AI SDK internals to detect if fix was called
- Consistent pattern with save tool
- Reliable detection regardless of SDK changes

## Considerations

- Follow existing pattern from save tool implementation
- Callback could also receive fix result for additional context
