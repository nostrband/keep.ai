import { DBInterface } from "../interfaces";

/**
 * Migration v36: Execution Model Tables
 *
 * Adds new tables for the event-driven execution model with topics,
 * handlers, and mutation tracking:
 *
 * New tables:
 * - topics: Topic definitions within a workflow
 * - events: Events in topic streams with status tracking
 * - handler_runs: Granular handler execution records (producer/consumer)
 * - mutations: Mutation ledger for tracking external side effects
 * - handler_state: Persistent state per handler
 *
 * Extended tables:
 * - script_runs: Add trigger, handler_run_count for session tracking
 * - workflows: Add handler_config, consumer_sleep_until for handler configuration
 *
 * See specs/exec-01-database-schema.md for design details.
 */
export async function migrateV36(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 36
  await tx.exec(`PRAGMA user_version = 36`);

  // =========================================
  // CREATE NEW TABLES
  // =========================================

  // topics table - Topic definitions within a workflow
  // CRSQLite requires NOT NULL columns to have DEFAULT values
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_topics_workflow ON topics(workflow_id)`);
  await tx.exec("SELECT crsql_as_crr('topics')");

  // events table - Events in topic streams
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      topic_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      reserved_by_run_id TEXT NOT NULL DEFAULT '',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic_id, status)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_events_reserved_by ON events(reserved_by_run_id)`);
  await tx.exec("SELECT crsql_as_crr('events')");

  // handler_runs table - Granular handler execution records
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS handler_runs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      script_run_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      handler_type TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT 'pending',
      prepare_result TEXT NOT NULL DEFAULT '',
      input_state TEXT NOT NULL DEFAULT '',
      output_state TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT '[]'
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_script_run ON handler_runs(script_run_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_workflow ON handler_runs(workflow_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_phase ON handler_runs(phase)`);
  await tx.exec("SELECT crsql_as_crr('handler_runs')");

  // mutations table - Mutation ledger for tracking external side effects
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS mutations (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      handler_run_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      tool_namespace TEXT NOT NULL DEFAULT '',
      tool_method TEXT NOT NULL DEFAULT '',
      params TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      last_reconcile_at INTEGER NOT NULL DEFAULT 0,
      next_reconcile_at INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_handler_run ON mutations(handler_run_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_workflow ON mutations(workflow_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_status ON mutations(status)`);
  await tx.exec("SELECT crsql_as_crr('mutations')");

  // handler_state table - Persistent state per handler
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS handler_state (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0,
      updated_by_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_handler_state_workflow ON handler_state(workflow_id)`);
  await tx.exec("SELECT crsql_as_crr('handler_state')");

  // =========================================
  // EXTEND EXISTING TABLES
  // =========================================

  // Extend script_runs table with session-related columns
  await tx.exec("SELECT crsql_begin_alter('script_runs')");
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN handler_run_count INTEGER NOT NULL DEFAULT 0`);
  await tx.exec("SELECT crsql_commit_alter('script_runs')");

  // Extend workflows table with handler config and scheduling columns
  await tx.exec("SELECT crsql_begin_alter('workflows')");
  await tx.exec(`ALTER TABLE workflows ADD COLUMN handler_config TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN consumer_sleep_until INTEGER NOT NULL DEFAULT 0`);
  await tx.exec("SELECT crsql_commit_alter('workflows')");
}
