import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Input record in the Input Ledger.
 *
 * Inputs track external data that triggered workflow processing.
 * Each input has user-facing metadata (title) and links to the
 * producer run that registered it.
 */
export interface Input {
  id: string;
  workflow_id: string;
  source: string;         // Connector name: 'gmail', 'slack', 'sheets', etc.
  type: string;           // Type within source: 'email', 'message', 'row', etc.
  external_id: string;    // External identifier from source system
  title: string;          // Human-readable description
  created_by_run_id: string;  // Producer run that registered this input
  created_at: number;
}

/**
 * Parameters for registering an external input.
 */
export interface RegisterInputParams {
  source: string;   // Connector name
  type: string;     // Type within source
  id: string;       // External identifier (maps to external_id column)
  title: string;    // Human-readable description
}

/**
 * Store for managing inputs in the Input Ledger.
 *
 * The Input Ledger tracks external inputs with user-facing metadata.
 * Registration is idempotent by (workflow_id, source, type, external_id):
 * re-registering the same input returns the existing inputId.
 *
 * Inputs are created by producers in the producer phase via Topics.registerInput().
 * The returned inputId is then used when publishing events to establish causal links.
 */
export class InputStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Register an external input. Idempotent by (workflow_id, source, type, external_id).
   * Returns existing inputId if already registered, or creates new.
   *
   * @param workflowId - Workflow ID
   * @param params - Input registration parameters
   * @param createdByRunId - Producer run that is registering this input
   * @returns The inputId (existing or newly created)
   */
  async register(
    workflowId: string,
    params: RegisterInputParams,
    createdByRunId: string,
    tx?: DBInterface
  ): Promise<string> {
    const db = tx || this.db.db;

    // Check if already exists
    const existing = await db.execO<{ id: string }>(
      `SELECT id FROM inputs
       WHERE workflow_id = ? AND source = ? AND type = ? AND external_id = ?`,
      [workflowId, params.source, params.type, params.id]
    );

    if (existing && existing.length > 0) {
      return existing[0].id;
    }

    // Create new input
    const inputId = bytesToHex(randomBytes(16));
    const now = Date.now();

    await db.exec(
      `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inputId, workflowId, params.source, params.type, params.id, params.title, createdByRunId, now]
    );

    return inputId;
  }

  /**
   * Get an input by ID.
   */
  async get(inputId: string, tx?: DBInterface): Promise<Input | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE id = ?`,
      [inputId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToInput(results[0]);
  }

  /**
   * Get all inputs for a workflow.
   */
  async getByWorkflow(workflowId: string, tx?: DBInterface): Promise<Input[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE workflow_id = ? ORDER BY created_at DESC`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToInput(row));
  }

  /**
   * Get inputs by IDs.
   */
  async getByIds(inputIds: string[], tx?: DBInterface): Promise<Input[]> {
    const db = tx || this.db.db;

    if (inputIds.length === 0) return [];

    const placeholders = inputIds.map(() => "?").join(", ");
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE id IN (${placeholders})`,
      inputIds
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToInput(row));
  }

  /**
   * Delete all inputs for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM inputs WHERE workflow_id = ?`, [workflowId]);
  }

  /**
   * Map a database row to an Input object.
   */
  private mapRowToInput(row: Record<string, unknown>): Input {
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      source: row.source as string,
      type: row.type as string,
      external_id: row.external_id as string,
      title: row.title as string,
      created_by_run_id: row.created_by_run_id as string,
      created_at: row.created_at as number,
    };
  }
}
