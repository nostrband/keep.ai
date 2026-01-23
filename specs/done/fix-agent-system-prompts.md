# Spec: Fix outdated agent system prompts

## Problem
After Spec 10 removed goal/notes/plan fields from the task system, the system prompts in `packages/agent/src/agent-env.ts` still reference these fields:
- Line 311: "You will be given a task info (goal, notes, plan, etc) for the current..."
- Line 318: "Use 'finish' if the task is completed and you want to updated task notes and plan"
- Line 362: "You will be given a task info (goal, notes, plan, etc) as input..."

This could confuse the LLM agent about what information is available or make it attempt to use removed functionality.

## Solution
Update the worker/planner prompts in agent-env.ts to only reference the "asks" field that is actually available:
- Replace references to "goal, notes, plan, etc" with "pending asks (questions)" or similar
- Remove references to updating notes/plan in finish tool description

## Expected Outcome
- System prompts accurately describe available task information
- Agent understands it only receives "asks" field
- No confusion about removed goal/notes/plan fields

## Considerations
- Review all system prompts in agent-env.ts for consistency
- Ensure the asks field usage is clearly explained
