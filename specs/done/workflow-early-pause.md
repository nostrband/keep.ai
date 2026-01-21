# Spec: Early Workflow Pause on User Request

## Problem
When a user clicks Pause in the UI, the workflow status is updated in the database, but a currently running workflow continues executing until completion. Workflows can be long-running, expensive, or buggy (looping), so users need a way to stop execution promptly.

## Desired Behavior
When a user pauses a workflow, any currently running execution should stop as soon as possible - specifically, on the next tool call from the script's JavaScript code.

## Approach
The agent-env's JavaScript tool-calling wrapper already intercepts all tool calls from scripts. This wrapper should check the workflow's current status before executing each tool. If the workflow has been paused (status changed to "disabled"), throw a custom error to abort execution immediately.

## Expected Outcome
- User clicks Pause → workflow stops within one tool call
- Clean abort with appropriate error handling
- No wasted compute on paused workflows
- User gets feedback that the workflow was stopped
