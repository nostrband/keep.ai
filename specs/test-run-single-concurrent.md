# Spec: Prevent concurrent test runs for same workflow

## Problem

If a user clicks "test run" multiple times rapidly, multiple test executions are triggered for the same workflow. This wastes resources and can cause confusion about which result to look at.

## Solution

Before starting a new test run, check if a test run is already in progress for the workflow. If so, return an error instead of starting another one.

## Expected Outcome

- Only one test run can be in progress per workflow at a time
- Attempting to start a test run while one is running returns an error
- UI can show appropriate feedback when a test is already running
