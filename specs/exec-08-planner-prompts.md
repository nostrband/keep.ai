# exec-08: Update Planner Prompts

## Goal

Update planner and maintainer prompts to generate scripts in the new workflow format with topics, producers, and consumers.

## New Script Format

Scripts must define a `workflow` object:

```javascript
const workflow = {
  topics: {
    "email.received": {},
    "row.created": {},
  },

  producers: {
    pollEmail: {
      schedule: { interval: "5m" },
      handler: async (state) => {
        // Poll external system, publish events
        const emails = await Gmail.api({
          method: 'users.messages.list',
          userId: 'me',
          q: `after:${state?.lastCheck || '1d'}`,
        });

        for (const email of emails.messages || []) {
          const details = await Gmail.api({
            method: 'users.messages.get',
            userId: 'me',
            id: email.id,
          });

          await Topics.publish("email.received", {
            messageId: email.id,
            title: `Email from ${details.from}: "${details.subject}"`,
            payload: {
              id: email.id,
              from: details.from,
              subject: details.subject,
              snippet: details.snippet,
            },
          });
        }

        return { lastCheck: new Date().toISOString() };
      }
    }
  },

  consumers: {
    processEmail: {
      subscribe: ["email.received"],

      prepare: async (state) => {
        const pending = await Topics.peek("email.received", { limit: 1 });
        if (pending.length === 0) {
          return { reservations: [], data: {} };
        }

        const event = pending[0];
        return {
          reservations: [{ topic: "email.received", ids: [event.messageId] }],
          data: {
            emailId: event.payload.id,
            from: event.payload.from,
            subject: event.payload.subject,
          },
        };
      },

      mutate: async (prepared) => {
        await Sheets.api({
          method: 'spreadsheets.values.append',
          spreadsheetId: 'SPREADSHEET_ID',
          range: 'Sheet1!A:C',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[prepared.data.from, prepared.data.subject, new Date().toISOString()]],
          },
        });
      },

      next: async (prepared, mutationResult) => {
        if (mutationResult.status === 'applied') {
          await Topics.publish("row.created", {
            messageId: `row:${prepared.data.emailId}`,
            title: `Row created for email from ${prepared.data.from}`,
            payload: { emailId: prepared.data.emailId },
          });
        }
      },
    }
  }
};
```

## Planner Prompt Updates

### Remove

- Remove "Logical Items" section
- Remove `Items.withItem()` examples
- Remove item-based mutation rules

### Add

New section: **"Workflow Structure"**

```
## Workflow Structure

Scripts must define a `workflow` object with this structure:

### Topics
Declare internal event streams:
\`\`\`javascript
topics: {
  "topic.name": {},
}
\`\`\`

### Producers
Poll external systems and publish events:
\`\`\`javascript
producers: {
  producerName: {
    schedule: { interval: "5m" },  // or { cron: "0 * * * *" }
    handler: async (state) => {
      // 1. Read from external system
      // 2. Publish events with Topics.publish()
      // 3. Return new state (cursor, timestamp, etc.)
    }
  }
}
\`\`\`

### Consumers
Process events in three phases:
\`\`\`javascript
consumers: {
  consumerName: {
    subscribe: ["topic.name"],

    // Phase 1: Select inputs (read-only)
    prepare: async (state) => {
      const events = await Topics.peek("topic.name");
      if (events.length === 0) return { reservations: [], data: {} };
      return {
        reservations: [{ topic: "topic.name", ids: [events[0].messageId] }],
        data: { /* computed from events */ },
      };
    },

    // Phase 2: Perform ONE mutation (optional)
    mutate: async (prepared) => {
      await ExternalService.api({ /* use prepared.data */ });
    },

    // Phase 3: Publish downstream events (optional)
    next: async (prepared, mutationResult) => {
      if (mutationResult.status === 'applied') {
        await Topics.publish("downstream.topic", { /* ... */ });
      }
    },
  }
}
\`\`\`
```

New section: **"Phase Rules"**

```
## Phase Rules

### Producer Phase
- CAN: Read external systems, publish to topics
- CANNOT: Mutate external systems, peek topics

### Prepare Phase
- CAN: Read external systems, peek subscribed topics
- CANNOT: Mutate external systems, publish to topics
- MUST: Return { reservations, data }

### Mutate Phase
- CAN: Perform ONE external mutation
- CANNOT: Read external systems, peek/publish topics
- NOTE: Mutation is terminal - no code after the mutation call

### Next Phase
- CAN: Publish to topics
- CANNOT: Read/mutate external systems, peek topics
```

New section: **"Event Design"**

```
## Event Design

Events need stable identifiers and descriptive titles:

### messageId
- Must be stable and unique within topic
- Based on external identifier (email ID, row ID, etc.)
- Used for idempotent publishing (duplicates ignored)

Good: \`email.id\`, \`\`row:\${invoice.id}\`\`
Bad: \`uuid()\`, \`Date.now()\`

### title
- Human-readable description
- Include identifying information
- Shown in UI for observability

Good: \`Email from alice@example.com: "Invoice December"\`
Bad: \`Processing item\`, \`Email #5\`
```

## Maintainer Prompt Updates

### Remove

- Remove "Logical Item Constraints" section

### Add

New section: **"Workflow Constraints"**

```
## Workflow Constraints

When fixing workflow scripts:

### Can Modify
- Handler logic (prepare/mutate/next implementation)
- Data transformation and filtering
- Error handling within handlers
- State structure

### Cannot Modify
- Topic names (would break event routing)
- Consumer subscriptions (architectural change)
- Producer schedules (user expectation)
- Phase structure (prepare/mutate/next order)

### Must Preserve
- Event messageId generation logic (for idempotency)
- Reservation structure in prepare
- Single mutation per mutate phase

If fix requires changing topic names or subscriptions, fail explicitly and explain why re-planning is needed.
```

## Implementation

1. Update `packages/agent/src/agent-env.ts`:
   - Modify `PLANNER_SYSTEM_PROMPT`
   - Modify `MAINTAINER_SYSTEM_PROMPT`

2. Ensure prompts include:
   - Complete workflow structure example
   - Phase rules and restrictions
   - Topics API usage (peek, publish)
   - Event design guidelines

## Testing

- Generate script for "forward emails to Sheets" - verify correct structure
- Generate script for "summarize daily emails" - verify producer with state
- Fix broken consumer - verify constraints respected
- Validate generated scripts pass validation (exec-05)
