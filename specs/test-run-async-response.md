# Spec: Make test-run endpoint return immediately

## Problem

The `/api/workflow/test-run` endpoint blocks the HTTP connection for up to 5 minutes waiting for workflow execution to complete. This ties up server resources and provides poor user experience with no progress feedback.

## Solution

Change the endpoint to return immediately with the run_id after starting the test run. The app should then poll or check the run status separately.

## Expected Outcome

- Endpoint returns HTTP 202 with the run_id immediately after starting the test
- App uses existing run status mechanisms to show progress and results
- Server resources are not tied up waiting for workflow completion
- User sees responsive UI with status updates as the test progresses
