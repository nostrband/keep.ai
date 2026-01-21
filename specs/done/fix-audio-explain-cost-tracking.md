# Spec: Fix audio-explain cost tracking

## Problem

The `audio-explain` tool passes the full `usage` object to `createEvent` instead of wrapping it as `usage: { cost: usage.cost }` like all other tools do. The cost accumulation code in workflow-worker and task-worker checks `content?.usage?.cost`, which may not work correctly with the current structure.

This means audio transcription and processing costs may not be tracked in workflow/task runs, leading to incomplete cost reporting.

## Solution

Update the audio-explain tool to follow the same pattern as other tools when passing usage data to createEvent.

## Expected Outcome

- Audio processing costs are properly accumulated in workflow and task runs
- Cost display in UI reflects actual audio processing expenses
- Consistent event structure across all tools

## Considerations

- Audio transcription can be expensive, so missing these costs is significant
- Verify the usage object structure from the audio API to ensure cost field exists
