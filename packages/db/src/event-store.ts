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
  title: string;
  payload: unknown;
  status: EventStatus;
  reserved_by_run_id: string;
  created_by_run_id: string;
  attempt_number: number;
  created_at: number;
  updated_at: number;
}

/**
 * Event to publish to a topic.
 */
export interface PublishEvent {
  messageId: string;
  title: string;
  payload: unknown;
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
   * Idempotent by messageId - duplicates are silently ignored.
   *
   * @param workflowId - Workflow ID
   * @param topicName - Topic name
   * @param event - Event to publish
   * @param createdByRunId - Handler run that created this event
   * @returns The created event, or existing event if duplicate
   */
  async publishEvent(
    workflowId: string,
    topicName: string,
    event: PublishEvent,
    createdByRunId: string,
    tx?: DBInterface
  ): Promise<Event> {
    const db = tx || this.db.db;
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

    // Check for existing event with same messageId (idempotency)
    const existing = await this.getByMessageId(topicId, event.messageId, db);
    if (existing) {
      return existing;
    }

    // Create new event
    const id = bytesToHex(randomBytes(16));
    await db.exec(
      `INSERT INTO events (
        id, topic_id, workflow_id, message_id, title, payload, status,
        reserved_by_run_id, created_by_run_id, attempt_number,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, 1, ?, ?)`,
      [
        id,
        topicId,
        workflowId,
        event.messageId,
        event.title,
        JSON.stringify(event.payload),
        createdByRunId,
        now,
        now,
      ]
    );

    return {
      id,
      topic_id: topicId,
      workflow_id: workflowId,
      message_id: event.messageId,
      title: event.title,
      payload: event.payload,
      status: "pending",
      reserved_by_run_id: "",
      created_by_run_id: createdByRunId,
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

    return {
      id: row.id as string,
      topic_id: row.topic_id as string,
      workflow_id: row.workflow_id as string,
      message_id: row.message_id as string,
      title: row.title as string,
      payload,
      status: row.status as EventStatus,
      reserved_by_run_id: row.reserved_by_run_id as string,
      created_by_run_id: row.created_by_run_id as string,
      attempt_number: row.attempt_number as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
