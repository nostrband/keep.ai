/**
 * Google Docs tool for the Keep.AI agent.
 *
 * Provides access to Google Docs API for document operations.
 * Requires explicit account parameter (email address) for multi-account support.
 */

import { JSONSchema } from "../json-schema";
import { EvalContext } from "../sandbox/sandbox";
import debug from "debug";
import { google } from "googleapis";
import { AuthError, classifyGoogleApiError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { getGoogleCredentials, createGoogleOAuthClient } from "./google-common";
import { defineTool, Tool } from "./types";

const debugDocs = debug("agent:gdocs");

const SUPPORTED_METHODS = [
  "documents.get",
  "documents.create",
  "documents.batchUpdate",
] as const;

const READ_METHODS = new Set<string>([
  "documents.get",
]);

// Methods that should trigger event tracking (write operations)
// Uses explicit Set membership instead of includes() to avoid false positives (spec: fix-google-tools-event-tracking-pattern)
const TRACKED_METHODS = new Set<string>([
  "documents.create",
  "documents.batchUpdate",
]);

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    method: {
      enum: SUPPORTED_METHODS as unknown as string[],
      description: "Google Docs API method to call",
    },
    params: {
      description: "Parameters to pass to the Google Docs API method",
    },
    account: {
      type: "string",
      description:
        "Email address of the Google Docs account to use (e.g., user@gmail.com)",
    },
  },
  required: ["method", "account"],
};

interface Input {
  method: (typeof SUPPORTED_METHODS)[number];
  params?: any;
  account: string;
}

/**
 * Create Google Docs tool that uses ConnectionManager for credentials.
 *
 * The tool requires an explicit `account` parameter (email address) to specify
 * which Google Docs account to use. This prevents accidental account mixing in
 * multi-account setups.
 */
export function makeGDocsTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool<Input, unknown> {
  return defineTool({
    namespace: "GoogleDocs",
    name: "api",
    outputType: "document",
    description: `Access Google Docs API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. Mutation methods (require 'mutate' phase): ${SUPPORTED_METHODS.filter(m => !READ_METHODS.has(m)).join(", ")}. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the email address of the connected Google Docs account.`,
    inputSchema,
    isReadOnly: (params) => READ_METHODS.has(params.method),
    execute: async (input) => {
      const { method, params = {}, account } = input;

      const creds = await getGoogleCredentials(
        connectionManager,
        "gdocs",
        account,
        "GoogleDocs.api"
      );

      const connectionId = { service: "gdocs", accountId: account };

      debugDocs("Calling Google Docs API", {
        method,
        account,
        params,
      });

      try {
        const oAuth2Client = createGoogleOAuthClient(creds);
        const docs = google.docs({ version: "v1", auth: oAuth2Client });

        let result;
        switch (method) {
          case "documents.get":
            result = await docs.documents.get(params);
            break;
          case "documents.create":
            result = await docs.documents.create(params);
            break;
          case "documents.batchUpdate":
            result = await docs.documents.batchUpdate(params);
            break;
          default:
            throw new Error(`Method ${method} not implemented`);
        }

        // Track significant operations for auditing (spec: fix-google-tools-event-tracking-pattern)
        // Don't spam events with 'get' which usually happens in batches
        if (TRACKED_METHODS.has(method))
          await getContext().createEvent("gdocs_api_call", {
            method,
            account,
            params,
          });

        debugDocs("Google Docs API call completed", { method, account, success: true });

        return result.data;
      } catch (error) {
        debugDocs("Google Docs API call failed", {
          method,
          account,
          error: error instanceof Error ? error.message : String(error),
        });

        // Classify the error based on Google API response
        const classified = classifyGoogleApiError(error, "GoogleDocs.api");

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
