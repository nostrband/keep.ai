# Build & Run
- Requires Node.js >= 22.0.0, npm >= 10.9.0
- Monorepo using npm workspaces + Turbo
- `npm install` then `npm run build` from root
- Apps: web, server, cli, electron, user-server, push
- Packages: agent, browser, db, node, sync, proto

# Validation
Run these after implementing to get immediate feedback:

Tests: `cd packages/tests && npm test` (Vitest) or `cd apps/user-server && npm test` (Jest)
NOTE: tests in `packages/tests` might be out of date, add tests for new features and/or fix existing tests.
Typecheck: `npm run type-check`
Lint: Not configured

# Operational Notes
Succinct learnings about how to RUN the project:

**Environment**: Create `~/.keep.ai/.env` with `OPENROUTER_API_KEY`

**Development**:
- `cd apps/web && npm run build:frontend && cd ../apps/server && npm run build:all && npm start` - single nodejs process that hosts background workers and serves the web app

# Codebase Patterns
<add when discovered>