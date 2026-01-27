# Planner: Include Connected Accounts in Context

## Summary

Add connected service-account pairs to the planner system prompt so the agent knows upfront which accounts are available, instead of discovering them through tool errors.

## Problem

Currently, connector tools (Gmail, GDrive, GSheets, GDocs, Notion) require an `accountId` parameter, but the agent has no way to know which accounts are connected. The only discovery mechanism is:

1. Agent calls tool without account
2. Tool throws `LogicError` with "Available accounts: ..."
3. Agent retries with correct account

This wastes tokens and adds latency. The agent should know available accounts upfront.

## Solution

Include connected accounts map in `plannerSystemPrompt()` so the agent can reference accounts directly.

## Implementation

### 1. Pass Connections to AgentEnv

Modify `AgentEnv` constructor to accept a connections list:

```typescript
// packages/agent/src/agent-env.ts

export class AgentEnv {
  // ... existing fields
  private connections: Connection[];

  constructor(
    api: KeepDbApi,
    type: TaskType,
    task: Task,
    tools: Map<string, string>,
    userPath?: string,
    autonomyMode?: AutonomyMode,
    connections?: Connection[], // NEW
  ) {
    // ... existing init
    this.connections = connections || [];
  }
}
```

### 2. Add Connected Accounts Prompt Section

Add new method in `AgentEnv`:

```typescript
private connectedAccountsPrompt(): string {
  if (this.connections.length === 0) {
    return `## Connected Accounts
No external services connected. If the task requires Gmail, Google Drive, Google Sheets, Google Docs, or Notion, ask the user to connect the service in Settings.
`;
  }

  // Group by service
  const byService = new Map<string, Connection[]>();
  for (const conn of this.connections) {
    if (conn.status !== 'connected') continue; // Only show active connections
    const list = byService.get(conn.service) || [];
    list.push(conn);
    byService.set(conn.service, list);
  }

  if (byService.size === 0) {
    return `## Connected Accounts
No active connections. Some services may need re-authentication. Ask user to check Settings.
`;
  }

  const lines = ['## Connected Accounts', ''];

  const serviceNames: Record<string, string> = {
    gmail: 'Gmail',
    gdrive: 'Google Drive',
    gsheets: 'Google Sheets',
    gdocs: 'Google Docs',
    notion: 'Notion',
  };

  for (const [service, conns] of byService) {
    const displayName = serviceNames[service] || service;
    lines.push(`### ${displayName}`);
    for (const conn of conns) {
      const label = conn.label ? ` (${conn.label})` : '';
      const displayId = conn.metadata?.displayName || conn.accountId;
      lines.push(`- ${displayId}${label}`);
    }
    lines.push('');
  }

  lines.push('Use the account identifier (email or workspace ID) as the `account` parameter when calling connector tools.');

  return lines.join('\n');
}
```

### 3. Include in plannerSystemPrompt

Add the connected accounts section to `plannerSystemPrompt()`:

```typescript
private plannerSystemPrompt() {
  return `
You are an experienced javascript software engineer...

${this.connectedAccountsPrompt()}

${this.toolsPrompt()}

${this.jsPrompt([])}
...
`;
}
```

### 4. Pass Connections from TaskWorker

In `TaskWorker` where `AgentEnv` is instantiated, fetch and pass the connections:

```typescript
// packages/agent/src/task-worker.ts

// When creating AgentEnv, fetch connections
const connections = this.connectionManager
  ? await this.connectionManager.listConnections()
  : [];

const env = new AgentEnv(
  this.api,
  taskType,
  task,
  tools,
  this.userPath,
  autonomyMode,
  connections, // NEW
);
```

## Example Output

When the agent sees the system prompt, it will include:

```
## Connected Accounts

### Gmail
- user@gmail.com
- work@company.com (Work)

### Notion
- My Workspace (abc123)

Use the account identifier (email or workspace ID) as the `account` parameter when calling connector tools.
```

## Files to Modify

1. **`packages/agent/src/agent-env.ts`**
   - Add `connections` field to constructor
   - Add `connectedAccountsPrompt()` method
   - Include in `plannerSystemPrompt()`

2. **`packages/agent/src/task-worker.ts`**
   - Fetch connections from ConnectionManager
   - Pass connections to AgentEnv constructor

## Notes

- Only include connections with `status: 'connected'` - don't confuse agent with errored/expired connections
- Import `Connection` type from `@app/connectors`
- This change is for planner only (worker is legacy and won't be modified)
