# Build & Run
- Requires Node.js >= 22.0.0, npm >= 10.9.0
- Monorepo using npm workspaces + Turbo
- `npm install` then `npm run build` from root
- Apps: web, server, cli, electron, user-server, push
- Packages: agent, browser, db, node, sync, proto

# UX Tests
- `cd apps/server && DEBUG="*" PORT=3001 npm start` - launches the local server
- open `http://localhost:3001` to view the app
- to create a new clean user - stop the server, erase `/home/artur/.keep.ai/current_user.txt`, restart the server

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

**Debugging**:
To check current database state, read pubkey from `~/.keep.ai/current_user.txt` and then use `sqlite3 ~/.keep.ai/<pubkey>/data.db` to read the state (no mutations! will break cr-sqlite sync).

**DB**
- cr-sqlite requires all NOT NULL columns in CRR tables to have DEFAULT values
- cr-sqlite requires NO UNIQUE indexes on CRR tables aside from primary key, enforce unique-ness at code level, make sure select-before-insert always runs inside a tx to avoid races 
- if you do ALTER table on CRR tables then you can't write to these tables in the same migration (same tx) - split this migration into two and do writes in the second one
- there's no crsql_as_crr_undo to stop CRR-tracking on tables, tracked tables can't be deleted, they must be marked deprecated, code using them removed, tables left as is
- use `crsql_as_crr` when creating tables that should be synched, use `crsql_begin_alter`/`crsql_commit_alter` when altering synched tables, see other migrations as examples.

# Codebase Patterns
<add when discovered>