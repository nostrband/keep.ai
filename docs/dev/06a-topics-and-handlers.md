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
* `title` — human-readable, required for observability
* `payload` — arbitrary data
* Host-managed metadata (not exposed to scripts):
  * `status` — `pending`, `consumed`, `skipped`
  * `reserved_by` — reference to the consumer run that has reserved this event
  * `created_by` — reference to producer run that created the event

### Event Titles

Event titles are a **delegation interface**, not decoration. They are surfaced in execution traces, notifications, and escalation prompts.

Requirements:

* Include a stable external identifier
* Include a human-recognizable descriptor
* Describe *what the event represents*, not how it's processed

Good: `Email from alice@example.com: "Invoice December"`
Bad: `Processing item` or `Email #5`

### Event Lifecycle

Events transition through states:

* `pending` — awaiting processing
* `consumed` — successfully processed by a consumer run
* `skipped` — explicitly skipped by user action

State transitions are **host-managed**. Scripts never manually dequeue or mark events.

### Properties

* Topics are **fully observable** in the UI
* Events are **not deleted by default** — they are marked as consumed/handled
* Topics have **exactly one consumer** in v1
* Topics may be used as:
  * ingress (emails, Slack messages, timers)
  * internal workflow edges (output of one consumer becomes input to another)

---

## Producers

Producers convert unstructured external inputs into **formal system events**.

### Rules

Producers:

* May perform **read-only** external operations
* May enqueue events into topics; publishing is idempotent and deduplicated by `messageId`

Producers may NOT:

* Perform external mutations
* Consume events
* Peek topic queues

### State Management

Producers typically need to track ingress position (cursors, checkpoints) to avoid re-processing the same external data on each invocation.

State is managed through **functional return values**, not imperative storage:

* The producer receives its previous state as a parameter (undefined on first run)
* The producer returns its new state
* State is committed atomically with event publishes on successful completion

```js
producers: {
  async pollEmail(ctx, state) {
    const cursor = state?.cursor;
    const emails = await ctx.gmail.search({ query: "newer_than:24h", after: cursor });

    for (const e of emails) {
      await ctx.publish("email.received", {
        messageId: e.id,
        title: `Email from ${e.from}: "${e.subject}"`,
        payload: { subject: e.subject, from: e.from },
      });
    }

    return { cursor: emails.lastCursor };
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

---

## Consumers

A **consumer** processes events from subscribed topics and performs **at most one external mutation per run**.

### Subscriptions

* A consumer declares which topics it subscribes to
* A consumer may subscribe to **multiple topics**
* The scheduler invokes a consumer when pending events exist in **any** subscribed topic
* A consumer durably **reserves** input events that it intends to process
* Reserved events are atomically marked as processed if consumer completes successfully

Note: events are stored in append order, but there is no implicit ordering guarantee — consumers may selectively reserve; FIFO processing is the consumer's responsibility if needed

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
      schedule: { interval: "5m" },
      handler: async (ctx, state) => {
        const emails = await ctx.gmail.search({ after: state?.cursor });
        for (const e of emails) {
          await ctx.publish("email.received", {
            messageId: e.id,
            title: `Email from ${e.from}: "${e.subject}"`,
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

      async prepare(ctx, state) {
        const pending = await ctx.peek("email.received");
        if (pending.length === 0) return { reservations: [], data: {} };
        const event = pending[0];
        return {
          reservations: [{ topic: "email.received", ids: [event.messageId] }],
          data: { messageId: event.messageId, from: event.payload.from, subject: event.payload.subject }
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
          await ctx.publish("row.created", {
            messageId: `row:${prepared.data.messageId}`,
            title: `Row created for ${prepared.data.from}`,
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
* Chapter 17 — Event Management UX
