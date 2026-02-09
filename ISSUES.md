ISSUES:
- doesn't start if submitted from homepage
- logic error happened but no auto-fix
- event seems to be missing after logic error
- remove diagram from the workflow page?
- fix electron builds
- "Scroll up to load older messages"
- 'How can I help you today?' placeholder 

TODOs:
1. Make web app dev-testable, make API host use env var and pass server's endpoint so that server could work separately while the dev version would be npm run dev-ed
2. 
3. Remove 'ai' package's streamText() method - just call openrouter one step at a time, and convert resulting messages to UIMessage format.
4. Global per-connector permissions
7. LLM APIs pre/post validation and hardening
8. Script/patch validation, including LLM auditor (separate from Intent Contract extractor).
9. Testing/Dry-run...
