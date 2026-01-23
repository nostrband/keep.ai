# Spec: Fix internal navigation to use / instead of /new

## Problem
After Spec 06, the /new route redirects to /. However, internal navigation in the app still points to /new, causing unnecessary redirects:
- `apps/web/src/components/WorkflowsPage.tsx` line 21: "Create Workflow" button uses `navigate("/new")`
- `apps/web/src/components/ChatSidebar.tsx` line 59: "New Chat" link uses `/chat/new`

This creates extra redirect round-trips and could confuse browser history.

## Solution
Update all internal navigation to go directly to "/" instead of "/new" or "/chat/new":
1. WorkflowsPage.tsx: Change `navigate("/new")` to `navigate("/")`
2. ChatSidebar.tsx: Change link from `/chat/new` to `/`

## Expected Outcome
- Direct navigation without redirects
- Cleaner browser history
- Consistent navigation behavior

## Considerations
- Keep the /new redirect in place for backwards compatibility with external links/bookmarks
- Search for any other places that navigate to /new
