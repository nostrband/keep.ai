import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Topic record - a named event stream within a workflow.
 */
export interface Topic {
  id: string;
  workflow_id: string;
  name: string;
  created_at: number;
}

/**
 * Options for listing topics.
 */
export interface ListTopicsOptions {
  /** Maximum number of topics to return */
  limit?: number;
}

/**
 * Store for managing topics in the execution model.
 *
 * Topics are internal event streams that connect producers to consumers.
 * Each topic has a unique name within its workflow.
 */
export class TopicStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get a topic by ID.
   */
  async get(id: string, tx?: DBInterface): Promise<Topic | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM topics WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToTopic(results[0]);
  }

  /**
   * Get a topic by workflow ID and name.
   */
  async getByName(
    workflowId: string,
    name: string,
    tx?: DBInterface
  ): Promise<Topic | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM topics WHERE workflow_id = ? AND name = ?`,
      [workflowId, name]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToTopic(results[0]);
  }

  /**
   * Get or create a topic by workflow ID and name.
   * Returns the existing topic if it exists, otherwise creates a new one.
   */
  async getOrCreate(
    workflowId: string,
    name: string,
    tx?: DBInterface
  ): Promise<Topic> {
    if (!tx) {
      return this.db.db.tx((tx) => this.getOrCreate(workflowId, name, tx));
    }
    const db = tx;

    // Check if topic exists
    const existing = await this.getByName(workflowId, name, db);
    if (existing) {
      return existing;
    }

    // Create new topic
    const id = bytesToHex(randomBytes(16));
    const now = Date.now();

    await db.exec(
      `INSERT INTO topics (id, workflow_id, name, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, workflowId, name, now]
    );

    return {
      id,
      workflow_id: workflowId,
      name,
      created_at: now,
    };
  }

  /**
   * Create a topic. Throws if topic with same name exists in workflow.
   */
  async create(
    workflowId: string,
    name: string,
    tx?: DBInterface
  ): Promise<Topic> {
    if (!tx) {
      return this.db.db.tx((tx) => this.create(workflowId, name, tx));
    }
    const db = tx;

    // Check uniqueness: (workflow_id, name)
    const existing = await this.getByName(workflowId, name, db);
    if (existing) {
      throw new Error(`Topic '${name}' already exists in workflow ${workflowId}`);
    }

    const id = bytesToHex(randomBytes(16));
    const now = Date.now();

    await db.exec(
      `INSERT INTO topics (id, workflow_id, name, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, workflowId, name, now]
    );

    return {
      id,
      workflow_id: workflowId,
      name,
      created_at: now,
    };
  }

  /**
   * List topics for a workflow.
   */
  async list(
    workflowId: string,
    options: ListTopicsOptions = {},
    tx?: DBInterface
  ): Promise<Topic[]> {
    const db = tx || this.db.db;
    let query = `SELECT * FROM topics WHERE workflow_id = ? ORDER BY name`;
    const params: unknown[] = [workflowId];

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];

    return results.map((row) => this.mapRowToTopic(row));
  }

  /**
   * Delete a topic by ID.
   */
  async delete(id: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM topics WHERE id = ?`, [id]);
  }

  /**
   * Delete all topics for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM topics WHERE workflow_id = ?`, [workflowId]);
  }

  /**
   * Map a database row to a Topic object.
   */
  private mapRowToTopic(row: Record<string, unknown>): Topic {
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      name: row.name as string,
      created_at: row.created_at as number,
    };
  }
}
