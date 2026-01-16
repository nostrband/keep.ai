# AGENTS.md - Repository Guide for AI Assistants

## Project Overview

**Keep.AI** is an automation-focused AI assistant that runs entirely locally. Users describe automations in natural language, the AI creates JavaScript scripts, and those scripts execute on schedules or events. When script errors occur, the AI automatically fixes them.

### Core Concept
- **Local execution**: Agent runs locally, credentials stored locally, scripts execute locally
- **AI-generated automations**: User describes what they want → AI writes JS scripts → scripts run on cron/events
- **Self-healing**: Script errors are detected and auto-fixed by AI
- **LLM proxy**: Local app connects to `user-server` which handles Clerk auth, user balance tracking, and proxies LLM requests

## Database Structure

### Chat Layer (User-Facing)

| Table | Purpose |
|-------|---------|
| `chats` | User-facing chat threads |
| `chat_events` | Messages and arbitrary notifications with custom UI rendering |

### Agent Layer (Backend Processing)

| Table | Purpose |
|-------|---------|
| `threads` | Agentic loop sessions (internal) |
| `messages` | Messages within agentic threads |
| `tasks` | One task per automation, manages agentic loops |
| `task_runs` | One agentic loop execution, linked to one thread |

### Automation Layer

| Table | Purpose |
|-------|---------|
| `workflows` | Automation definitions |
| `scripts` | JS code for automations (has task_id, workflow_id, version) |
| `script_runs` | Tracks individual script executions |

### Event System

| Table | Purpose |
|-------|---------|
| `inbox` | Internal event delivery with source/target type/id |

The inbox routes events between components:
- User messages flow from `chats` → `inbox` → `tasks`
- Future: external events (new email) → `inbox` → `workflows`

### Client-Server Split

- **Web App** (`apps/web`): React SPA for UI
- **Server** (`apps/server`): Fastify server running background workers, provides DB access to UI, runs locally on user desktop
- **User Server** (`apps/user-server`): Clerk auth, balance tracking, LLM request proxying, central server in the cloud

## Build Commands

### Root Level (via Turbo)

```bash
npm install                  # Install all dependencies
npm run build                # Build all packages/apps
npm run dev                  # Start all packages in watch mode
npm run clean                # Clean all build outputs
npm run type-check           # Type check all packages
```

### Build Targets

The web app supports multiple build modes:

```bash
npm run build                # All modes (frontend, serverless, electron)
npm run build:frontend       # Standard web app
npm run build:serverless     # Serverless deployment
npm run build:electron       # Electron desktop build
```

### Per-Package Commands

| Package | Build | Dev | Test |
|---------|-------|-----|------|
| apps/web | `npm run build:all` | `npm run dev` | - |
| apps/server | `npm run build` | `npm run dev` | - |
| apps/cli | `npm run build` | `npm run dev` | - |
| apps/electron | `npm run build` | `npm run start:dev` | - |
| apps/push | `npm run build` | `npm run dev` | - |
| apps/user-server | `npm run build` | `npm run dev` | `npm test` |
| packages/agent | `npm run build` | `npm run dev` | - |
| packages/db | `npm run build` | `npm run dev` | - |
| packages/sync | `npm run build` | `npm run dev` | - |
| packages/proto | `npm run build` | `npm run dev` | - |
| packages/node | `npm run build` | `npm run dev` | - |
| packages/browser | `npm run build` | `npm run dev` | - |
| packages/tests | - | - | `npm test` |

### Running the Desktop App

```bash
cd apps/electron
npm run dist                 # Build and package for distribution
npm run start                # Run electron app
npm run start:dev            # Run in dev mode
```

### Running Servers

```bash
# Main web server (runs workers, serves UI)
cd apps/server && npm run dev

# User management server (auth, billing, LLM proxy)
cd apps/user-server && npm run dev

# Push notification server
cd apps/push && npm run dev
```

## Testing

**Two test frameworks are used:**

1. **Vitest** (packages/tests): Core package tests
   ```bash
   cd packages/tests
   npm test                   # Watch mode
   npm run test:run           # Single run
   ```

2. **Jest** (apps/user-server): Server tests
   ```bash
   cd apps/user-server
   npm test                   # Run tests
   npm run test:watch         # Watch mode
   ```

Test files are located at:
- `packages/tests/src/*.test.ts` - Core functionality tests
- `apps/user-server/src/__tests__/*.test.ts` - User server tests

## Key Architecture Patterns

### Local-First
All data stored locally in SQLite. Agent runs locally, credentials stay local, scripts execute locally. Only LLM calls go through the user-server proxy.

### Automation Flow
1. User describes automation in chat
2. AI creates task + workflow + script
3. Workflow scheduler triggers script on cron/events
4. Script runs in QuickJS sandbox
5. Errors detected → AI auto-fixes script

### CRDT Sync via Nostr
Peer-to-peer synchronization uses the Nostr protocol. CRDTs handle conflict resolution automatically. Serverless web app build allows to remotely connect to desktop app via E2EE sync over Nostr. 
