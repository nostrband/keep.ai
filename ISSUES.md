

ISSUES:
- reconciliation doesn't seem to work, not implemented right? and host-managed mutation retries? 
- remove diagram from the workflow page?
- fix macos builds
- we have to make sure task-scheduler can't launch more that 1 task per workflow, meaning several maintainer tasks + planner - planner first, maintainers one by one second
- stack traces have no line number of any other hint at where the issue is - just 'not a function' or some such, plus script run page doesn't show which handler was running, and I guess when auto-fix will run it also needs info on which handler failed
- provide hints into what constitutes mutations vs not, like Text.* tools aren't mutations and can be re-executed... maybe? why not 
- script_runs table has same error/logs as handler_runs, think on getting rid of this table
- 'idle' with 'server error' doesn't seem right, we can't really know
- shouldn't we display handler runs instead of script runs on workflow page?
- what does 'run now' button do? run all producers?
- schedule on workflow page is still cron expr, should be human readable, but maybe it's also impl detail - the actual schedule is now inside each producer, right? workflow-scheduler should take that into account, not script/workflow 'cron' field, also 'schedule' tool seems no longer needed right?
- on homepage workflow has 'active' badge while it has 'maintenance' flag, we should display maintenance somehow - either extra 'fixing' icon near/inside 'active' badge, or separate badge value like 'Fixing' - the workflow is definitely not 'active' in user's mind if it's stopped for maintenance
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
