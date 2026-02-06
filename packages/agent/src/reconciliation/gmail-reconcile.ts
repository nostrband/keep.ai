/**
 * Gmail Reconciliation (exec-18)
 *
 * Per docs/dev/13-reconciliation.md §13.6.3:
 * - mutation params: { to, subject, body, idempotency_key }
 * - reconcile: search sent folder for message matching idempotency key
 * - if found → applied with message ID
 * - if not found → failed
 * - if search fails → retry
 */

import { google } from "googleapis";
import type { ReconcileResult } from "@app/db";
import type { MutationParams } from "./types";
import type { ConnectionManager } from "@app/connectors";
import { getGoogleCredentials, createGoogleOAuthClient } from "../tools/google-common";
import { ReconciliationRegistry } from "./registry";
import debug from "debug";

const log = debug("reconciliation:gmail");

/**
 * Gmail send mutation parameters (parsed from MutationParams.params).
 */
interface GmailSendParams {
  /** Recipient email address */
  to: string;
  /** Email subject */
  subject?: string;
  /** Email body */
  body?: string;
  /** Account (email) to send from */
  account: string;
  /** Idempotency key for reconciliation */
  idempotencyKey?: string;
}

/**
 * Reconcile a Gmail send mutation.
 *
 * Strategy:
 * 1. Parse idempotency key from mutation params
 * 2. Search sent mail for messages containing the idempotency key in headers or body
 * 3. If found, return applied with message ID
 * 4. If not found after search, return failed (safe to retry send)
 * 5. If search fails (network error), return retry
 *
 * Note: The idempotency key should be embedded in the email (e.g., as X-Keep-Idempotency header
 * or in a hidden span in the body) by the send mutation implementation.
 */
async function reconcileGmailSend(
  params: MutationParams,
  connectionManager: ConnectionManager
): Promise<ReconcileResult> {
  log("Reconciling Gmail send mutation");

  // Parse mutation parameters
  let sendParams: GmailSendParams;
  try {
    sendParams = JSON.parse(params.params) as GmailSendParams;
  } catch (error) {
    log("Failed to parse mutation params", error);
    // Can't reconcile without params - treat as retry (let user handle)
    return { status: "retry" };
  }

  // Need idempotency key for reconciliation
  const idempotencyKey = params.idempotencyKey || sendParams.idempotencyKey;
  if (!idempotencyKey) {
    log("No idempotency key - cannot reconcile");
    // Without idempotency key, we can't verify - return retry to escalate
    return { status: "retry" };
  }

  // Need account for authentication
  if (!sendParams.account) {
    log("No account specified - cannot reconcile");
    return { status: "retry" };
  }

  try {
    // Get credentials and create Gmail client
    const creds = await getGoogleCredentials(
      connectionManager,
      "gmail",
      sendParams.account,
      "Gmail.reconcile"
    );
    const oAuth2Client = createGoogleOAuthClient(creds);
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    // Search sent folder for message with idempotency key
    // The idempotency key should be in the message (header or body)
    const searchQuery = `in:sent "${idempotencyKey}"`;
    log(`Searching for message with query: ${searchQuery}`);

    const searchResult = await gmail.users.messages.list({
      userId: "me",
      q: searchQuery,
      maxResults: 1,
    });

    if (searchResult.data.messages && searchResult.data.messages.length > 0) {
      const messageId = searchResult.data.messages[0].id;
      log(`Found sent message: ${messageId}`);
      return {
        status: "applied",
        result: { messageId },
      };
    }

    // Message not found in sent folder - mutation did not complete
    log("Message not found in sent folder");
    return { status: "failed" };
  } catch (error) {
    // Search failed - could be network issue, auth issue, etc.
    log("Gmail reconciliation error", error);

    // Check if it's an auth error (should escalate, not retry)
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("invalid credentials") ||
        message.includes("token expired") ||
        message.includes("unauthorized")
      ) {
        // Auth error - can't reconcile, return retry to escalate
        return { status: "retry" };
      }
    }

    // Transient error - retry reconciliation
    return { status: "retry" };
  }
}

/**
 * Create a Gmail send reconcile method bound to a connection manager.
 */
export function createGmailSendReconciler(connectionManager: ConnectionManager) {
  return (params: MutationParams): Promise<ReconcileResult> => {
    return reconcileGmailSend(params, connectionManager);
  };
}

/**
 * Register Gmail reconcile methods with the registry.
 *
 * Should be called during application initialization with the connection manager.
 */
export function registerGmailReconcileMethods(connectionManager: ConnectionManager): void {
  ReconciliationRegistry.register({
    namespace: "Gmail",
    method: "send",
    reconcile: createGmailSendReconciler(connectionManager),
  });

  log("Registered Gmail reconcile methods");
}
