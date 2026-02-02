# 16. Scheduling (Draft)

> **Status**: Draft proposal for v1. Requires review and refinement.

This chapter defines when and how handlers are invoked by the host runtime.

---

## Principles

1. **Host-controlled** — the host decides when to run handlers; scripts do not control their own scheduling
2. **Simple and predictable** — users can understand when their workflow will run
3. **No busy-looping** — the system must not waste resources polling when there's nothing to do
4. **Responsive** — new work should be processed promptly

---

## Producer Scheduling

Producers poll external systems for new data. They run on a **configured schedule**.

### Schedule Types

* **Interval** — run every N minutes (e.g., every 5 minutes)
* **Cron** — run on cron schedule (e.g., "0 * * * *" for hourly)

### Trigger Conditions

A producer run starts when:

1. Schedule fires, AND
2. No other run (producer or consumer) is active for this workflow

If a scheduled time arrives while another run is active, the producer run is skipped (not queued). The next scheduled time will trigger normally.

### Manual Trigger

Users can manually trigger a producer run from the UI. This bypasses the schedule but still respects the "no concurrent runs" constraint.

### Configuration

```js
producers: {
  pollEmail: {
    schedule: { interval: "5m" },  // or { cron: "*/5 * * * *" }
    handler: async (ctx, state) => { ... }
  }
}
```

---

## Consumer Scheduling

Consumers process events from topics. They run **when there is work to do**.

### Trigger Conditions

A consumer run starts when:

1. At least one pending event exists in any subscribed topic, AND
2. No other run (producer or consumer) is active for this workflow, AND
3. The consumer is not in backoff sleep

### The Empty Reservation Problem

A consumer's `prepare` phase may return empty reservations even when pending events exist:

* Waiting for correlated events across topics
* Waiting for a time window
* Filtering events by criteria not yet met
* Batching threshold not reached

If the host immediately retries, it creates a busy-loop. The host must back off.

### Backoff Strategy

When `prepare` returns empty reservations:

1. Consumer enters **sleep** state
2. Sleep ends when ANY of:
   * New event is published to any subscribed topic
   * Fixed timeout expires (e.g., 5 minutes)
   * User manually triggers the consumer

This handles common patterns efficiently:

| Pattern | Behavior |
|---------|----------|
| Simple FIFO processing | Never returns empty; no backoff needed |
| Correlation (wait for event B after event A) | Sleeps until B arrives, then wakes immediately |
| Time window (process after 1 hour) | Sleeps, wakes on timeout, checks again |
| Batching (wait for 10 items) | Sleeps until new events accumulate |

### Why Not Script-Provided Hints?

Scripts could return hints like "wake me when topic X changes" or "wake me in 1 hour." However:

* Scripts are untrusted code — hints might be incorrect or malicious
* Adds complexity to the prepare return type
* The simple "wake on new event OR timeout" covers most cases

If v1 experience shows this is insufficient, v2 could add validated hints.

### Timeout Configuration

The backoff timeout is host policy (see Chapter 15), not script-controlled. Default: 5 minutes.

For workflows with time-based patterns (e.g., "process daily at 9am"), the timeout ensures progress even without new events. The consumer wakes, checks conditions, and either processes or sleeps again.

---

## Workflow-Level Constraints

### Single-Threaded Execution

From Chapter 06: at most one run is active per workflow at any time.

The scheduler enforces this:

* If producer schedule fires during an active run → skip
* If consumer trigger fires during an active run → queue (run after current completes)
* Queued consumer runs are coalesced (only one pending consumer run at a time)

### Priority

When a run completes and multiple triggers are pending:

1. Consumer runs take priority over producer runs (process existing work before ingesting more)
2. Among consumers, the one with oldest pending events runs first

### Paused Workflows

When a workflow is paused (due to failure, user action, or indeterminate mutation):

* No scheduled runs occur
* Manual triggers are still allowed (for debugging)
* Resume unpauses and allows normal scheduling

---

## Run Lifecycle Integration

The scheduler interacts with run states (see Chapter 06):

| Run Outcome | Scheduler Action |
|-------------|------------------|
| `committed` | Check for pending work, schedule next run |
| `failed` | Pause workflow, await user action |
| `suspended` | Pause workflow, await resolution |
| Empty reservations | Enter backoff sleep |

---

## Observable State

Users can see in the UI:

* Next scheduled producer run time
* Consumer state: ready / sleeping (with wake conditions) / running
* Queue depth per topic (pending event count)
* Last run time and outcome

---

## Summary

**Producers**: Run on configured schedule (interval or cron).

**Consumers**: Run when pending events exist. Sleep with timeout when prepare returns empty reservations. Wake on new events or timeout.

This design is simple, handles common patterns, requires no trust in script behavior, and avoids busy-looping.
