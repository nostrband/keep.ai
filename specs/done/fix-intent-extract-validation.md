# Fix: Add Zod Validation to Intent Extraction LLM Response

## Source
- Review: `reviews/d4bb056.txt`
- Commit: `d4bb056` (exec-17: Intent Contract)
- Severity: CRITICAL

## Problem

In `packages/agent/src/intent-extract.ts`, the LLM response is parsed and cast without validation:

```typescript
// Line 165
const extracted: IntentExtractionResult = JSON.parse(content);
```

This creates multiple risks:
1. Missing required fields (goal, title) → crashes UI and maintainer
2. Non-array types for array fields (inputs, outputs) → TypeError on `.map()`
3. Non-string array items → corrupted context for maintainer agent
4. Invalid JSON → crashes with no user feedback

## Verification

Research confirmed:
1. Issue has NOT been fixed as of latest commit
2. Codebase uses Zod extensively for similar validation (SaveInfoSchema, FixInfoSchema, etc.)
3. `text-extract.ts` demonstrates the proper pattern with error classification
4. UI component (`WorkflowIntentSection.tsx`) also lacks defensive checks

## Fix

### Step 1: Add Zod Schema to intent-extract.ts

```typescript
import { z } from "zod";

const IntentExtractionSchema = z.object({
  goal: z.string().min(1),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  assumptions: z.array(z.string()),
  nonGoals: z.array(z.string()),
  semanticConstraints: z.array(z.string()),
  title: z.string().min(1),
});

type IntentExtractionResult = z.infer<typeof IntentExtractionSchema>;
```

### Step 2: Replace Unvalidated Parse (around line 165)

```typescript
// Before
const extracted: IntentExtractionResult = JSON.parse(content);

// After
let extracted: IntentExtractionResult;
try {
  extracted = IntentExtractionSchema.parse(JSON.parse(content));
} catch (error) {
  if (error instanceof z.ZodError) {
    throw new LogicError(
      `Invalid intent extraction response: ${error.errors.map(e => e.message).join(", ")}`,
      { source: "extractIntent" }
    );
  }
  throw new LogicError(`Failed to parse intent extraction response: ${content}`, {
    source: "extractIntent",
  });
}
```

### Step 3: Add Defensive Checks to UI Component

In `apps/web/src/components/WorkflowIntentSection.tsx`, add optional chaining:

```typescript
// Line 45: Before
{intentSpec.inputs.length > 0 && ...}
// After
{intentSpec.inputs?.length > 0 && ...}

// Line 49: Before
intentSpec.inputs.map(...)
// After
intentSpec.inputs?.map(...) ?? null

// Similar for outputs, assumptions, nonGoals, semanticConstraints
```

### Step 4: Consolidate parseIntentSpec (Optional Improvement)

Export `parseIntentSpec` from `@app/db` or a shared utility to avoid duplication between:
- `packages/agent/src/intent-extract.ts` (lines 194-203)
- `apps/web/src/components/WorkflowIntentSection.tsx` (lines 11-20)

## Files to Modify

1. `packages/agent/src/intent-extract.ts` - Add Zod schema and validated parsing
2. `apps/web/src/components/WorkflowIntentSection.tsx` - Add defensive checks

## Testing

1. Add test case for malformed LLM response (missing fields)
2. Add test case for invalid types (string instead of array)
3. Add test case for empty required fields
4. Verify UI renders gracefully with missing optional fields

## Notes

- The Zod schema should use `.min(1)` for goal and title to ensure non-empty strings
- Import `LogicError` from existing error classification utilities
- This follows the established pattern from `text-extract.ts`
