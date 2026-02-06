# exec-17: Intent Contract

## Overview

This spec implements the **Intent Spec** (also called Intent Contract) feature as documented in `docs/dev/10-intent-spec.md`. The Intent Spec is a system-maintained, human-readable description of what an automation is meant to do.

It exists to:
- Prevent semantic drift when implementations are generated and repaired by LLMs
- Make implicit defaults explicit for users
- Anchor meaning across script generations and repairs
- Give both humans and LLMs a stable reference point

**Current State:** Workflows have a `summary` field on the Script model that is generated ad-hoc. There's no structured intent tracking.

**Target State:** Workflows have a dedicated `intent_spec` stored at the workflow level (not per-script), extracted via a focused LLM prompt when planner conversations occur.

---

## Database Schema

### Phase 1: Add intent_spec column to workflows table

Add a new column to the `workflows` table:

```sql
ALTER TABLE workflows ADD COLUMN intent_spec TEXT NOT NULL DEFAULT '';
```

The `intent_spec` column stores a JSON object with the following structure:

```typescript
interface IntentSpec {
  version: number;              // Schema version for future evolution
  extractedAt: string;          // ISO timestamp of extraction
  extractedFromTaskId: string;  // The task ID whose messages were used

  // Core intent fields (from docs/dev/10-intent-spec.md)
  goal: string;                 // The intended outcome in plain language
  inputs: string[];             // What information is consumed
  outputs: string[];            // What effects are expected
  assumptions: string[];        // Choices made when user didn't specify
  nonGoals: string[];           // Things explicitly NOT meant to do
  semanticConstraints: string[]; // Behavioral rules in human language

  // Metadata
  title: string;                // User-facing workflow title (extracted here)
}
```

The `title` field in the Workflow table remains as-is for backwards compatibility, but the authoritative title comes from the Intent Spec once extracted.

---

## Intent Extraction

### Phase 2: Create Intent Extraction Prompt

Create a new prompt in the agent package that:
1. Takes the planner conversation (user messages only, not assistant responses)
2. Extracts structured intent
3. Returns the IntentSpec JSON

The prompt should be concise and focused:

```
You are extracting the user's intent from a workflow creation conversation.

Given the user's messages, extract:
1. GOAL: What outcome does the user want? (1-2 sentences)
2. INPUTS: What external data/events trigger or feed this workflow?
3. OUTPUTS: What external effects should the workflow produce?
4. ASSUMPTIONS: What defaults are implied but not stated explicitly?
5. NON-GOALS: What is this workflow explicitly NOT meant to do?
6. SEMANTIC CONSTRAINTS: Any behavioral rules mentioned?
7. TITLE: A short, descriptive title for this workflow (2-5 words)

Return a JSON object with these fields. Be concise. If a field has no content, use an empty array.
```

Location: `packages/agent/src/prompts/extract-intent.ts`

### Phase 3: Call Intent Extraction After Planner Save

When the planner's save tool successfully creates or updates a script:
1. Gather all user messages from the associated task
2. Call the intent extraction LLM with those messages
3. Store the resulting IntentSpec in the workflow's `intent_spec` field
4. Update the workflow's `title` field with the extracted title

This happens in the save tool handler or immediately after successful script save.

**Trigger conditions:**
- Only when a NEW major version is saved (planner, not maintainer)
- Extract from the task that triggered the planner session
- Skip if intent already exists and conversation hasn't changed

---

## UI Updates

### Phase 4: Display Intent Spec in Workflow Detail Page

Replace the current "Summary" section with "Intent" section showing:

**Goal:**
> [The extracted goal statement]

**What it does:**
- Watches: [inputs as bullet points]
- Produces: [outputs as bullet points]

**Assumptions:**
[Only show if non-empty]
- [assumptions as bullet points]

**What it won't do:**
[Only show if non-empty]
- [non-goals as bullet points]

**Semantic Constraints:**
[Only show if non-empty, with "Best-effort" label]
- [constraints as bullet points]

### Phase 5: Update Workflow List Card

The workflow list (main page) already shows title. No change needed there.

The workflow detail page header should use `intentSpec.title` if available, falling back to `workflow.title`.

---

## Maintainer Integration

### Phase 6: Pass Intent Spec to Maintainer

When the maintainer runs to fix a script:
1. Include the Intent Spec in the context
2. The maintainer prompt should reference it as the semantic contract
3. Repairs must satisfy the Intent Spec (best-effort, not enforced)

Update maintainer prompt to include:
```
## Intent Contract (do not modify)
Goal: {goal}
Inputs: {inputs}
Outputs: {outputs}
Assumptions: {assumptions}
Non-goals: {nonGoals}
Constraints: {semanticConstraints}

Your repair must maintain fidelity to this intent. Do not expand or reduce scope.
```

---

## Migration

### Phase 7: Backfill Existing Workflows

For existing workflows without an Intent Spec:
- Display "Intent not extracted" in UI
- Provide "Extract Intent" action button
- When clicked, run intent extraction on the task messages
- No automatic backfill (user-initiated only)

---

## API Endpoints

### Phase 8: Intent API

Add endpoint to manually trigger intent extraction:

```
POST /api/workflows/:id/extract-intent
```

Response:
```json
{
  "success": true,
  "intentSpec": { ... }
}
```

---

## Tests

### Phase 9: Test Coverage

1. **Database tests:**
   - Migration adds intent_spec column
   - IntentSpec JSON serialization/deserialization
   - Workflow queries include intent_spec

2. **Intent extraction tests:**
   - Prompt produces valid JSON
   - Handles empty conversations gracefully
   - Extracts all fields correctly from sample conversations

3. **Integration tests:**
   - Save tool triggers intent extraction
   - Maintainer receives intent spec in context
   - UI displays intent spec correctly

4. **API tests:**
   - Extract intent endpoint works
   - Returns error for invalid workflow ID

---

## Implementation Order

1. Phase 1: Database migration (v45)
2. Phase 2: Intent extraction prompt
3. Phase 3: Hook extraction to planner save
4. Phase 4: UI - Intent section on workflow detail
5. Phase 5: UI - Title from intent spec
6. Phase 6: Maintainer prompt update
7. Phase 7: Backfill UI and action
8. Phase 8: API endpoint
9. Phase 9: Tests

---

## Not In Scope

- Automatic validation of repairs against intent (future auditor feature)
- Intent diffing when user modifies workflow
- Intent versioning history (single current version only)
- Permission/policy extraction (separate from intent)

---

## Success Criteria

1. New workflows get Intent Spec extracted on first save
2. Workflow detail page shows structured intent instead of summary
3. Maintainer prompt includes intent as context
4. Existing workflows show "Intent not extracted" with action button
5. 15+ new tests for intent functionality
