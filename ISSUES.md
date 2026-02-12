

ISSUES:
- Show diff should also expand the comment to view long ones untruncated
- output names are namespaces - very vague, we should probably transform ns.method to something human-readable, or have connector declare 'Output name' variable
- reconciliation doesn't seem to work, not implemented right? and host-managed mutation retries? 
- outputs only include namespace, need tool name too (at getOutputStatsByWorkflow)
- Message: Failed at Gmail.api: request to https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is%3Aunread%20%28from%3Anoreply%20OR%20from%3Anewsletter%20OR%20from%3Adigest%20OR%20from%3Anotification%20OR%20subject%3A%28newsletter%20OR%20digest%20OR%20weekly%20OR%20daily%20OR%20update%29%29&maxResults=10 failed, reason: getaddrinfo EAI_AGAIN gmail.googleapis.com - classified as logic, why?
- fix macos builds
- we have to make sure task-scheduler can't launch more that 1 task per workflow, meaning several maintainer tasks + planner - planner first, maintainers one by one second
- stack traces have no line number of any other hint at where the issue is - just 'not a function' or some such, plus script run page doesn't show which handler was running, and I guess when auto-fix will run it also needs info on which handler failed
- provide hints into what constitutes mutations vs not, not sure if current prompts include this
- LLM calls are 'mutations' because they produce side-effects (tokens spent), the 'output' records should show costs - thus mutation ledger probably needs one more column
- total costs on workflow page, with per-day/per-run stats etc
- script_runs table has same error/logs as handler_runs, I feel logs field is to be deprecated, error field to include a copy from handler_run (btw does handler run have script_run_id?), handler runs batch (producer + downstream consumers) should probably be grouped and shown on script run page, makes sense?
- what does 'run now' button do? run all producers?
- script runs full list shown on workflow page, let's show last 3 and 'View all (N)' button which opens /workflows/<id>/runs page with full list with pagination and filters
- on homepage workflow has 'active' badge while it has 'maintenance' flag, we should display maintenance somehow - either extra 'fixing' icon near/inside 'active' badge, or separate badge value like 'Fixing' - the workflow is definitely not 'active' in user's mind if it's stopped for maintenance
- why mutation is created before in_flight status? like it feels like tool wrapper would immediately, unconditionally set the tool status to inflight after mutation row added? or do we still create it but then check input format and set 'failed' if input invalid? what's the logic there?
- why is maintainer's inbox full of data if it only needs failed handler_run_id?
- notifications should have buttons styled properly (grey box etc) and cursor pointer
- should notifications have their own page? or be expandable? bcs long-form notifs can't be fully read now
- on workflow/input page the 'what happened' orders by time desc - should be by time asc
- on workflow/input page internal events are just id and status, should allow viewing the content somehow? or remove them entirely? also show event topic, at least 
- notifications must go through browser notifcs, through push api and through electron native notifs

TODOs:
1. Make web app dev-testable, make API host use env var and pass server's endpoint so that server could work separately while the dev version would be npm run dev-ed
4. Global per-connector permissions
7. LLM APIs pre/post validation and hardening
8. Script/patch validation, including LLM auditor (separate from Intent Contract extractor).
