1. http://localhost:3001/workflows?filter=drafts doesn't filter Drafts - all are shown


TODOs:
2. Intent Contract - somehow extracted from user input messages using separate LLM prompt, written instead of 'summary' (title should be chosen there too), only changes if new planner messages are posted, displayed in workflow page instead of summary.
3. Remove 'ai' package's streamText() method - just call openrouter one step at a time, and convert resulting messages to UIMessage format.
4. withItem - mutations only allowed if 'withItem' context is started, item id used as idempotency key, mutation item with 'title' is started in db, if it's finished then marked as 'done', mutations fail and abort the script if outside withItem, mutation writes 'mutation X started with item I' then attempts, writes 'mutation X done result R' after finished, if retried with same I then same result R is returned. 
5. Mutation reconciliation - if mutation fails with uncertainty (including if we're restarted after crash and see pending mutations) then we need per-mutation reconcile protocol, it's auto-executed and we either write mutation result to db or we escalate to user with proper explanation - user must either re-enable the script or re-plan. Script isn't allowed to run until all mutations are marked as reconciled (finished/failed).
6. Granular permissions, per-workflow - per-resource, per-method, with allow/disallow and other policies like "max per run/day" etc, requestable by the planner - planner/validator should produce static tool use list which translate to permissions (FIXME what if it dynamically accesses resources by name? must be able to request * or 'prefix*' or 'ask at runtime'?)
7. LLM APIs pre/post validation and hardening
8. Script/patch validation, including LLM auditor (separate from Intent Contract extractor).
9. Testing/Dry-run...
