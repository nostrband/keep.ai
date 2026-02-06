# 06a. Topics and Handlers

This chapter defines the data structures and handler types that make up a workflow.

For the conceptual model and rationale, see Chapter 06. For consumer execution details, see Chapter 06b.

---

## Topics

A **topic** is a durable, append-only event stream.

### Event Schema

Each event has:

* `topic` — the topic name
* `messageId` — stable identifier, caller-provided or host-generated
* `payload` — arbitrary data
* Host-managed metadata (not exposed to scripts):
  * `status` — `pending`, `consumed`, `skipped`
  * `reserved_by` — reference to the consumer run that has reserved this event
  * `created_by` — reference to the run that created the event
  * `caused_by` — array of Input IDs that causally led to this event (see Input Ledger and Causal Tracking below)

Note: Events do not have titles. User-facing metadata lives in the Input Ledger, not in events.

### Event Lifecycle

Events transition through states:

* `pending` — awaiting processing
* `consumed` — successfully processed by a consumer run
* `skipped` — explicitly skipped by user action

State transitions are **host-managed**. Scripts never manually dequeue or mark events.

### Publishing Semantics

Event publishing is deduplicated by `messageId` using **last-write-wins**:

* If `messageId` doesn't exist → event is created
* If `messageId` exists → `title` and `payload` are **updated**
* Event `status` is **preserved** (pending/consumed/skipped unchanged)

**Why last-write-wins?** This makes auto-fix more robust. If a producer publishes an event with a buggy payload, auto-fix can correct the script, and the retry may update the event with the corrected payload — before the consumer processes it.

### Properties

* Topics are **fully observable** in the UI
* Events are **not deleted** — they are marked as consumed/handled
* Topics have **exactly one producer** and **exactly one consumer** in v1
* Topics may be used as:
  * ingress (emails, Slack messages, timers)
  * internal workflow edges (output of one consumer becomes input to another)

---

## Input Ledger

The **Input Ledger** tracks external inputs that trigger workflow processing. Inputs are separate from events — they represent "what external thing happened" in user terms.

### Input Schema

Each input has:

* `inputId` — host-generated unique identifier
* `source` — the connector/system that provided the input (from known list: `gmail`, `slack`, `sheets`, `system`, etc.)
* `type` — the type of input within that source (per-source valid types: `email`, `thread`, `message`, `schedule`, `random`, etc.)
* `id` — external identifier from the source system
* `title` — human-readable description for the user
* Host-managed metadata:
  * `created_by` — reference to the producer run that registered this input
  * `created_at` — timestamp

### Uniqueness

Inputs are unique by `source + type + id` per workflow. Registering the same combination returns the existing `inputId` (idempotent for retries).

### Input Titles

Input titles are a **delegation interface**, not decoration. They are surfaced in the UI, notifications, and escalation prompts.

Requirements:

* Include a stable external identifier
* Include a human-recognizable descriptor
* Describe *what the input is*, not how it's processed

Good: `Email from alice@example.com: "Invoice December"`
Bad: `Processing item` or `Item #5`

### Known Sources

The `source` field comes from the registered connectors list. Scripts cannot invent arbitrary sources because all external access goes through host-managed connectors. This ensures:

* Consistent naming in the UI
* Permissions are enforced per-source
* Custom connectors register their source/type before use

Common sources:

| Source | Types | Description |
|--------|-------|-------------|
| `gmail` | `email`, `thread` | Google Mail |
| `slack` | `message`, `reaction` | Slack messages |
| `sheets` | `row` | Google Sheets |
| `calendar` | `event` | Calendar events |
| `system` | `schedule`, `random` | System-generated triggers |

### Why Separate from Events?

Inputs and events serve different purposes:

| Concept | Purpose | Contains |
|---------|---------|----------|
| **Input** | User-facing "what triggered this" | source, type, id, title |
| **Event** | Internal workflow coordination | topic, messageId, payload |

This separation:
* Keeps events simple (no UI concerns)
* Makes "Input" a first-class concept for planners
* Avoids ID collisions (inputs are unique by source+type+id, not just id)
* Enables clean causal tracking

---

## Causal Tracking

Events maintain a **causal chain** back to the Inputs that originated them. This enables the UX to show users "what happened to my input" without exposing internal workflow structure.

All `caused_by` references point to the Input Ledger, not to other events:

* **Producer events** have `caused_by: [inputId]` from the registered input
* **Consumer-emitted events** inherit `caused_by` from their reserved input events (flattened to inputIds)

When a consumer reserves events and emits new events in `next`, the host automatically sets `caused_by` on emitted events to the union of `caused_by` from all reserved events.

**Example:**
```
Producer registers Input I1 (source: gmail, type: email, id: "abc123")
Producer publishes event E1 to topic T1 (caused_by: [I1])
Consumer C1 reserves E1, emits E2 to topic T2 (caused_by: [I1])
Consumer C2 reserves E2, emits E3 to topic T3 (caused_by: [I1])
```

All events trace back to Input I1. The UI shows:
* Item: "Email from alice@example.com" (from Input I1)
* Outputs: mutations from C1 and C2

This allows the UI to:
* Show all downstream work for a given input
* Compute "pending" status by checking if any event with this inputId is pending
* Display "what happened" summaries without exposing internal topics

See Chapter 17 for how causal tracking is used in the UX.

---

## Producers

Producers convert unstructured external inputs into **formal system events**.

### Declaration

Producers must declare which topics they publish to:

```ts
producers: {
  pollEmail: {
    publishes: ["email.received"],  // required declaration
    schedule: { interval: "5m" },
    handler: async (ctx, state) => { ... }
  }
}
```

**Validation rules:**

* Attempting to publish to an undeclared topic is a runtime error
* This enables static validation of the workflow graph before execution

### Rules

Producers:

* May perform **read-only** external operations
* Must **register inputs** before publishing events that reference them
* May enqueue events **only to declared topics**; publishing uses last-write-wins deduplication by `messageId` (see Publishing Semantics above)
* May publish to **multiple topics** in a single call (for fan-out)

Producers may NOT:

* Perform external mutations
* Consume events
* Peek topic queues
* Publish to undeclared topics

### Registering Inputs

Producers must register external inputs before publishing events:

```ts
const inputId = ctx.registerInput({
  source: "gmail",        // from known connectors list
  type: "email",          // valid type for this source
  id: email.id,           // external identifier
  title: `Email from ${email.from}: "${email.subject}"`
})
```

Registration is **idempotent**: same `source + type + id` returns the same `inputId`. This is safe for retries.

### Publishing Events

After registering an input, publish events referencing it:

```ts
// Single topic
ctx.publish("email.received", {
  messageId: email.id,
  inputId,                // required - links to Input Ledger
  payload: { from: email.from, subject: email.subject }
})

// Multiple topics (fan-out)
ctx.publish(["sheets.queue", "slack.queue"], {
  messageId: email.id,
  inputId,
  payload: { ... }
})
```

The `inputId` is required in producer publishes. The host sets `caused_by: [inputId]` on created events.

### State Management

Producers typically need to track ingress position (cursors, checkpoints) to avoid re-processing the same external data on each invocation.

State is managed through **functional return values**, not imperative storage:

* The producer receives its previous state as a parameter (undefined on first run)
* The producer returns its new state
* State is committed atomically with event publishes on successful completion

```js
producers: {
  pollEmail: {
    publishes: ["email.received"],
    schedule: { interval: "5m" },
    handler: async (ctx, state) => {
      const cursor = state?.cursor;
      const emails = await ctx.gmail.search({ query: "newer_than:24h", after: cursor });

      for (const e of emails) {
        // Register the external input
        const inputId = ctx.registerInput({
          source: "gmail",
          type: "email",
          id: e.id,
          title: `Email from ${e.from}: "${e.subject}"`
        });

        // Publish event referencing the input
        await ctx.publish("email.received", {
          messageId: e.id,
          inputId,
          payload: { subject: e.subject, from: e.from },
        });
      }

      return { cursor: emails.lastCursor };
    }
  }
}
```

### State Semantics

* State is the **script's own data** — the host does not interpret or enforce any structure
* State should be kept small; the only constraint is a size limit (implementation-defined)
* If producer crashes or fails, state is not updated; on relaunch, producer re-runs with previous state
* Since event publishing is idempotent by `messageId`, re-processing the same inputs is safe

### Replay Semantics

Producers can be relaunched freely (on crash, exception, or scheduled retry):

* Only side effect is publishing events, which is idempotent
* State saved only on successful completion
* On relaunch, producer may re-poll external sources and re-publish events; duplicates are deduplicated by `messageId`

### Input Registration (Prompting Guidance)

Inputs represent **external items** in the user's mental model. LLMs generating producer code should follow these guidelines:

* **One external item = one input**: Each email, message, or record should be registered as one input
* **Batching is explicit**: Only batch multiple items into one input when the intent explicitly requires batch processing (e.g., "daily summary of all messages")
* **Titles describe the item**: Input titles should describe what the item *is*, not what will happen to it
* **Use correct source/type**: Match the connector being used (gmail/email, slack/message, etc.)

Good: `Email from alice@example.com: "Invoice December"`
Bad: `Item to process` or `Batch of 5 emails`

These guidelines are essential for good UX. See Chapter 17 for how inputs are displayed to users.

---

## Consumers

A **consumer** processes events from subscribed topics and performs **at most one external mutation per run**.

### Declaration

Consumers declare both their subscriptions and publications:

```ts
consumers: {
  processEmail: Keep.consumer({
    subscribe: ["email.received"],   // topics to consume from
    publishes: ["row.created"],      // topics that may be published to in next
    // ...
  })
}
```

**Validation rules:**

* `subscribe` declares topics this consumer reads from (via `peek`)
* `publishes` declares topics this consumer may emit to in `next`
* Attempting to publish to an undeclared topic is a runtime error

### Publishing in `next`

Consumer's `next` phase can publish events to declared topics:

```ts
// Single topic
ctx.publish("row.created", {
  messageId: `row:${id}`,
  payload: { rowId }
})

// Multiple topics (fan-out)
ctx.publish(["notify.slack", "notify.email"], {
  messageId: `notify:${id}`,
  payload: { ... }
})
```

**No `inputId` required** — the host automatically inherits `caused_by` from the reserved events. All emitted events trace back to the original inputs.

### Subscriptions

* A consumer may subscribe to **multiple topics**
* The scheduler invokes a consumer when pending events exist in **any** subscribed topic
* A consumer durably **reserves** input events that it intends to process
* Reserved events are atomically marked as processed if consumer completes successfully

Note: there is no event ordering guarantee — consumers may selectively reserve; FIFO processing is the consumer's responsibility if needed

### Run Identity

Each consumer run is assigned a unique **run identifier** by the host at creation. This identifier:

* Keys the mutation ledger (see Chapter 13)
* Tracks run state across suspensions
* Is internal to the host — scripts do not interact with it

### Execution Model

Consumers are structured as **three explicit phases**:

```
prepare → mutate → next
```

This structure is enforced by the host. See Chapter 06b for detailed phase semantics.

### State Management

Like producers, consumers manage state through functional return values:

* The consumer's `prepare` phase receives previous state as a parameter
* The consumer's `next` phase may return new state
* State is committed atomically with run completion

---

## Workflow Declaration Example

```js
export default Keep.workflow({
  name: "email-to-sheets",

  topics: {
    "email.received": {},
    "row.created": {},
  },

  producers: {
    pollEmail: {
      publishes: ["email.received"],
      schedule: { interval: "5m" },
      handler: async (ctx, state) => {
        const emails = await ctx.gmail.search({ after: state?.cursor });
        for (const e of emails) {
          // Register the external input
          const inputId = ctx.registerInput({
            source: "gmail",
            type: "email",
            id: e.id,
            title: `Email from ${e.from}: "${e.subject}"`
          });

          // Publish event referencing the input
          await ctx.publish("email.received", {
            messageId: e.id,
            inputId,
            payload: { subject: e.subject, from: e.from },
          });
        }
        return { cursor: emails.lastCursor };
      }
    }
  },

  consumers: {
    processEmail: Keep.consumer({
      subscribe: ["email.received"],
      publishes: ["row.created"],

      async prepare(ctx, state) {
        const pending = await ctx.peek("email.received");
        if (pending.length === 0) return { reservations: [], data: {} };
        const event = pending[0];
        return {
          reservations: [{ topic: "email.received", ids: [event.messageId] }],
          data: { messageId: event.messageId, from: event.payload.from, subject: event.payload.subject },
          ui: {
            title: `Add row for ${event.payload.from}`
          }
        };
      },

      async mutate(ctx, prepared) {
        await ctx.sheets.appendRow({
          spreadsheetId: "...",
          values: [prepared.data.from, prepared.data.subject]
        });
      },

      async next(ctx, prepared, mutationResult) {
        if (mutationResult.status === 'applied') {
          // No inputId needed - caused_by inherited from reserved events
          await ctx.publish("row.created", {
            messageId: `row:${prepared.data.messageId}`,
            payload: { rowId: mutationResult.result.rowId }
          });
        }
      },
    })
  }
});
```

---

## Related Chapters

* Chapter 06 — Execution Model (concepts)
* Chapter 06b — Consumer Lifecycle (phase details)
* Chapter 16 — Scheduling
* Chapter 17 — Inputs & Outputs
