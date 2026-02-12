import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Event status in the topic stream.
 * - pending: Available for consumption
 * - reserved: Reserved by a consumer run, awaiting processing
 * - consumed: Successfully processed
 * - skipped: Explicitly skipped (e.g., on error resolution)
 */
export type EventStatus = "pending" | "reserved" | "consumed" | "skipped";

/**
 * Event record in a topic stream.
 */
export interface Event {
  id: string;
  topic_id: string;
  workflow_id: string;
  message_id: string;
  /**
   * @deprecated Event titles are deprecated per exec-15. User-facing metadata
   * lives in the Input Ledger. This field is preserved for backward compatibility
   * with existing events but should not be used for new events.
   */
  title: string;
  payload: unknown;
  status: EventStatus;
  reserved_by_run_id: string;
  created_by_run_id: string;
  /** Array of input IDs that caused this event (exec-15 causal tracking) */
  caused_by: string[];
  attempt_number: number;
  created_at: number;
  updated_at: number;
}

/**
 * Event to publish to a topic.
 */
export interface PublishEvent {
  messageId: string;
  /**
   * @deprecated Event titles are deprecated per exec-15. User-facing metadata
   * lives in the Input Ledger. This field is accepted for backward compatibility
   * but will be ignored for new events (stored as empty string).
   */
  title?: string;
  payload: unknown;
  /** Array of input IDs that caused this event (exec-15 causal tracking) */
  causedBy?: string[];
}

/**
 * Options for peeking events.
 */
export interface PeekEventsOptions {
  /** Maximum number of events to return */
  limit?: number;
  /** Filter by status (default: 'pending') */
  status?: EventStatus;
}

/**
 * Reservation specification for consumer prepare phase.
 */
export interface EventReservation {
  topic: string;
  ids: string[];
}

/**
 * Store for managing events in topic streams.
 *
 * Events flow through topics connecting producers to consumers.
 * Lifecycle: pending → reserved → consumed/skipped
 */
export class EventStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get an event by ID.
   */
  async get(id: string, tx?: DBInterface): Promise<Event | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM events WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToEvent(results[0]);
  }

  /**
   * Get an event by topic ID and message ID.
   */
  async getByMessageId(
    topicId: string,
    messageId: string,
    tx?: DBInterface
  ): Promise<Event | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM events WHERE topic_id = ? AND message_id = ?`,
      [topicId, messageId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToEvent(results[0]);
  }

  /**
   * Peek pending events from a topic (for prepare phase).
   * Returns events without changing their status.
   */
  async peekEvents(
    workflowId: string,
    topicName: string,
    options: PeekEventsOptions = {},
    tx?: DBInterface
  ): Promise<Event[]> {
    const db = tx || this.db.db;
    const limit = options.limit ?? 100;
    const status = options.status ?? "pending";

    const results = await db.execO<Record<string, unknown>>(
      `SELECT e.* FROM events e
       JOIN topics t ON t.id = e.topic_id
       WHERE t.workflow_id = ? AND t.name = ? AND e.status = ?
       ORDER BY e.created_at ASC
       LIMIT ?`,
      [workflowId, topicName, status, limit]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToEvent(row));
  }

  /**
   * Get events by message IDs within a topic.
   */
  async getEventsByIds(
    workflowId: string,
    topicName: string,
    messageIds: string[],
    tx?: DBInterface
  ): Promise<Event[]> {
    const db = tx || this.db.db;

    if (messageIds.length === 0) return [];

    // Build query with placeholders
    const placeholders = messageIds.map(() => "?").join(", ");
    const results = await db.execO<Record<string, unknown>>(
      `SELECT e.* FROM events e
       JOIN topics t ON t.id = e.topic_id
       WHERE t.workflow_id = ? AND t.name = ? AND e.message_id IN (${placeholders})`,
      [workflowId, topicName, ...messageIds]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToEvent(row));
  }

  /**
   * Publish an event to a topic.
   * Idempotent by messageId - on conflict, updates payload and caused_by.
   *
   * @param workflowId - Workflow ID
   * @param topicName - Topic name
   * @param event - Event to publish
   * @param createdByRunId - Handler run that created this event
   * @returns The created event, or updated event if duplicate
   */
  async publishEvent(
    workflowId: string,
    topicName: string,
    event: PublishEvent,
    createdByRunId: string,
    tx?: DBInterface
  ): Promise<Event> {
    if (!tx) {
      return this.db.db.tx((tx) => this.publishEvent(workflowId, topicName, event, createdByRunId, tx));
    }
    const db = tx;
    const now = Date.now();

    // Get or create topic
    const topicResults = await db.execO<Record<string, unknown>>(
      `SELECT id FROM topics WHERE workflow_id = ? AND name = ?`,
      [workflowId, topicName]
    );

    let topicId: string;
    if (!topicResults || topicResults.length === 0) {
      // Create topic
      topicId = bytesToHex(randomBytes(16));
      await db.exec(
        `INSERT INTO topics (id, workflow_id, name, created_at)
         VALUES (?, ?, ?, ?)`,
        [topicId, workflowId, topicName, now]
      );
    } else {
      topicId = topicResults[0].id as string;
    }

    // Per exec-15: title is deprecated, new events have empty title
    // caused_by is the new causal tracking field
    const causedBy = event.causedBy || [];
    const causedByJson = JSON.stringify(causedBy);

    // Check for existing event with same messageId (idempotency)
    const existing = await this.getByMessageId(topicId, event.messageId, db);
    if (existing) {
      // Update payload and caused_by on conflict (last-write-wins per spec)
      await db.exec(
        `UPDATE events SET payload = ?, caused_by = ?, updated_at = ?
         WHERE topic_id = ? AND message_id = ?`,
        [JSON.stringify(event.payload), causedByJson, now, topicId, event.messageId]
      );
      return {
        ...existing,
        payload: event.payload,
        caused_by: causedBy,
        updated_at: now,
      };
    }

    // Create new event with empty title (deprecated) and caused_by
    const id = bytesToHex(randomBytes(16));
    await db.exec(
      `INSERT INTO events (
        id, topic_id, workflow_id, message_id, title, payload, status,
        reserved_by_run_id, created_by_run_id, caused_by, attempt_number,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', ?, 'pending', '', ?, ?, 1, ?, ?)`,
      [
        id,
        topicId,
        workflowId,
        event.messageId,
        JSON.stringify(event.payload),
        createdByRunId,
        causedByJson,
        now,
        now,
      ]
    );

    return {
      id,
      topic_id: topicId,
      workflow_id: workflowId,
      message_id: event.messageId,
      title: "",  // Deprecated, always empty for new events
      payload: event.payload,
      status: "pending",
      reserved_by_run_id: "",
      created_by_run_id: createdByRunId,
      caused_by: causedBy,
      attempt_number: 1,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Reserve events for a handler run.
   * Sets status='reserved' and reserved_by_run_id.
   *
   * @param handlerRunId - Handler run reserving the events
   * @param reservations - Array of { topic, ids } to reserve
   */
  async reserveEvents(
    handlerRunId: string,
    reservations: EventReservation[],
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    for (const reservation of reservations) {
      if (reservation.ids.length === 0) continue;

      // Get topic ID
      const topicResults = await db.execO<Record<string, unknown>>(
        `SELECT e.topic_id FROM events e
         JOIN topics t ON t.id = e.topic_id
         WHERE t.name = ? AND e.message_id = ?
         LIMIT 1`,
        [reservation.topic, reservation.ids[0]]
      );

      if (!topicResults || topicResults.length === 0) continue;
      const topicId = topicResults[0].topic_id as string;

      // Build update query
      const placeholders = reservation.ids.map(() => "?").join(", ");
      await db.exec(
        `UPDATE events
         SET status = 'reserved', reserved_by_run_id = ?, updated_at = ?
         WHERE topic_id = ? AND message_id IN (${placeholders}) AND status = 'pending'`,
        [handlerRunId, now, topicId, ...reservation.ids]
      );
    }
  }

  /**
   * Consume events reserved by a handler run.
   * Sets status='consumed' for all events reserved by this run.
   */
  async consumeEvents(handlerRunId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    await db.exec(
      `UPDATE events
       SET status = 'consumed', updated_at = ?
       WHERE reserved_by_run_id = ? AND status = 'reserved'`,
      [now, handlerRunId]
    );
  }

  /**
   * Skip events reserved by a handler run.
   * Sets status='skipped' for all events reserved by this run.
   */
  async skipEvents(handlerRunId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    await db.exec(
      `UPDATE events
       SET status = 'skipped', updated_at = ?
       WHERE reserved_by_run_id = ? AND status = 'reserved'`,
      [now, handlerRunId]
    );
  }

  /**
   * Release events reserved by a handler run back to pending.
   * Used when a handler run fails and needs to release reservations.
   */
  async releaseEvents(handlerRunId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    await db.exec(
      `UPDATE events
       SET status = 'pending', reserved_by_run_id = '', attempt_number = attempt_number + 1, updated_at = ?
       WHERE reserved_by_run_id = ? AND status = 'reserved'`,
      [now, handlerRunId]
    );
  }

  /**
   * Release orphaned reserved events back to pending on startup.
   * Only releases events whose reserving handler run is terminal (committed,
   * failed, suspended) or missing from the DB entirely. Active runs are left
   * alone — the scheduler's resume/retry logic handles those.
   */
  async releaseOrphanedReservedEvents(tx?: DBInterface): Promise<number> {
    const db = tx || this.db.db;
    const now = Date.now();

    // Release events reserved by runs that are terminal or no longer exist
    const reserved = await db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM events e
       WHERE e.status = 'reserved'
       AND NOT EXISTS (
         SELECT 1 FROM handler_runs h
         WHERE h.id = e.reserved_by_run_id
         AND h.status = 'active'
       )`
    );
    const count = reserved?.[0]?.count ?? 0;
    if (count === 0) return 0;

    await db.exec(
      `UPDATE events
       SET status = 'pending', reserved_by_run_id = '', attempt_number = attempt_number + 1, updated_at = ?
       WHERE status = 'reserved'
       AND NOT EXISTS (
         SELECT 1 FROM handler_runs h
         WHERE h.id = events.reserved_by_run_id
         AND h.status = 'active'
       )`,
      [now]
    );

    return count;
  }

  /**
   * Count pending events for a topic.
   */
  async countPending(
    workflowId: string,
    topicName: string,
    tx?: DBInterface
  ): Promise<number> {
    const db = tx || this.db.db;

    const results = await db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM events e
       JOIN topics t ON t.id = e.topic_id
       WHERE t.workflow_id = ? AND t.name = ? AND e.status = 'pending'`,
      [workflowId, topicName]
    );

    if (!results || results.length === 0) return 0;
    return results[0].count;
  }

  /**
   * Batch count pending events by topic (exec-11).
   *
   * Avoids N+1 queries when checking multiple topics.
   *
   * @param workflowId - Workflow ID
   * @param topicNames - Array of topic names to check
   * @returns Map of topic name to pending count
   */
  async countPendingByTopic(
    workflowId: string,
    topicNames: string[],
    tx?: DBInterface
  ): Promise<Map<string, number>> {
    const db = tx || this.db.db;

    if (topicNames.length === 0) {
      return new Map();
    }

    const placeholders = topicNames.map(() => "?").join(", ");
    const results = await db.execO<{ topic_name: string; count: number }>(
      `SELECT t.name as topic_name, COUNT(e.id) as count
       FROM topics t
       LEFT JOIN events e ON e.topic_id = t.id AND e.status = 'pending'
       WHERE t.workflow_id = ? AND t.name IN (${placeholders})
       GROUP BY t.name`,
      [workflowId, ...topicNames]
    );

    const map = new Map<string, number>();
    // Initialize all topics with 0
    for (const name of topicNames) {
      map.set(name, 0);
    }
    // Update with actual counts
    if (results) {
      for (const row of results) {
        map.set(row.topic_name, row.count);
      }
    }
    return map;
  }

  /**
   * Check if any topic has pending events (exec-11).
   *
   * @param workflowId - Workflow ID
   * @param topicNames - Array of topic names to check
   * @returns true if any topic has pending events
   */
  async hasPendingEvents(
    workflowId: string,
    topicNames: string[],
    tx?: DBInterface
  ): Promise<boolean> {
    const db = tx || this.db.db;

    if (topicNames.length === 0) {
      return false;
    }

    const placeholders = topicNames.map(() => "?").join(", ");
    const results = await db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM events e
       JOIN topics t ON t.id = e.topic_id
       WHERE t.workflow_id = ? AND t.name IN (${placeholders}) AND e.status = 'pending'
       LIMIT 1`,
      [workflowId, ...topicNames]
    );

    if (!results || results.length === 0) return false;
    return results[0].count > 0;
  }

  /**
   * Check if any pending events exist for a workflow (any topic).
   * Efficient single query for scheduler consumer-only work detection.
   */
  async hasAnyPendingForWorkflow(
    workflowId: string,
    tx?: DBInterface
  ): Promise<boolean> {
    const db = tx || this.db.db;

    const results = await db.execO<{ found: number }>(
      `SELECT 1 as found FROM events WHERE workflow_id = ? AND status = 'pending' LIMIT 1`,
      [workflowId]
    );

    return !!(results && results.length > 0);
  }

  /**
   * Get events reserved by a handler run.
   */
  async getReservedByRun(
    handlerRunId: string,
    tx?: DBInterface
  ): Promise<Event[]> {
    const db = tx || this.db.db;

    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM events WHERE reserved_by_run_id = ? AND status = 'reserved'`,
      [handlerRunId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToEvent(row));
  }

  /**
   * Get events that reference an input in their caused_by (exec-16).
   *
   * @param inputId - Input ID to search for
   * @param options - Query options (status filter, limit)
   * @returns Events that have this input in their caused_by
   */
  async getByInputId(
    inputId: string,
    options: { status?: EventStatus[]; limit?: number } = {},
    tx?: DBInterface
  ): Promise<Event[]> {
    const db = tx || this.db.db;

    let query = `
      SELECT * FROM events
      WHERE (caused_by LIKE '%"' || ? || '"%')
    `;
    const params: unknown[] = [inputId];

    if (options.status && options.status.length > 0) {
      const placeholders = options.status.map(() => "?").join(", ");
      query += ` AND status IN (${placeholders})`;
      params.push(...options.status);
    }

    query += ` ORDER BY created_at DESC`;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];
    return results.map((row) => this.mapRowToEvent(row));
  }

  /**
   * Get the union of caused_by from all events reserved by a handler run.
   * Used in consumer's next phase to inherit causal tracking (exec-15).
   *
   * @param handlerRunId - Handler run ID
   * @returns Deduplicated array of input IDs from all reserved events
   */
  async getCausedByForRun(
    handlerRunId: string,
    tx?: DBInterface
  ): Promise<string[]> {
    const db = tx || this.db.db;

    const results = await db.execO<{ caused_by: string }>(
      `SELECT caused_by FROM events WHERE reserved_by_run_id = ?`,
      [handlerRunId]
    );

    if (!results) return [];

    const inputIds = new Set<string>();
    for (const row of results) {
      try {
        const causedBy = JSON.parse(row.caused_by || "[]");
        if (Array.isArray(causedBy)) {
          for (const id of causedBy) {
            if (typeof id === "string" && id) {
              inputIds.add(id);
            }
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return [...inputIds];
  }

  /**
   * Delete all events for a topic.
   */
  async deleteByTopic(topicId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM events WHERE topic_id = ?`, [topicId]);
  }

  /**
   * Delete all events for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM events WHERE workflow_id = ?`, [workflowId]);
  }

  /**
   * Map a database row to an Event object.
   */
  private mapRowToEvent(row: Record<string, unknown>): Event {
    let payload: unknown = {};
    try {
      const payloadStr = row.payload as string;
      if (payloadStr) {
        payload = JSON.parse(payloadStr);
      }
    } catch {
      // Keep empty object if parsing fails
    }

    // Parse caused_by JSON array
    let causedBy: string[] = [];
    try {
      const causedByStr = row.caused_by as string;
      if (causedByStr) {
        const parsed = JSON.parse(causedByStr);
        if (Array.isArray(parsed)) {
          causedBy = parsed.filter((id): id is string => typeof id === "string");
        }
      }
    } catch {
      // Keep empty array if parsing fails
    }

    return {
      id: row.id as string,
      topic_id: row.topic_id as string,
      workflow_id: row.workflow_id as string,
      message_id: row.message_id as string,
      title: (row.title as string) || "",
      payload,
      status: row.status as EventStatus,
      reserved_by_run_id: row.reserved_by_run_id as string,
      created_by_run_id: row.created_by_run_id as string,
      caused_by: causedBy,
      attempt_number: row.attempt_number as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
