import { DBInterface } from "../interfaces";

/**
 * Migration v45: Intent Contract
 *
 * Per exec-17 spec: Intent Contract
 *
 * This migration adds:
 * 1. `intent_spec` column on `workflows` - JSON object storing structured intent
 *
 * The Intent Spec stores:
 * - Goal: what outcome the user wants
 * - Inputs: what external data/events trigger the workflow
 * - Outputs: what external effects should be produced
 * - Assumptions: defaults implied but not stated
 * - NonGoals: what the workflow explicitly won't do
 * - SemanticConstraints: behavioral rules (best-effort)
 * - Title: extracted short title for the workflow
 *
 * See specs/new/exec-17-intent-contract.md for design details.
 */
export async function migrateV45(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 45
  await tx.exec(`PRAGMA user_version = 45`);

  // =========================================
  // ALTER workflows TABLE - Add intent_spec column
  // =========================================

  // Use crsql_begin_alter/crsql_commit_alter for CRR tables
  await tx.exec("SELECT crsql_begin_alter('workflows')");

  await tx.exec(`
    ALTER TABLE workflows ADD COLUMN intent_spec TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('workflows')");
}
