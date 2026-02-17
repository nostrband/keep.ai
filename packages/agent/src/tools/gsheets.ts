/**
 * Google Sheets tool for the Keep.AI agent.
 *
 * Provides access to Google Sheets API for spreadsheet operations.
 * Requires explicit account parameter (email address) for multi-account support.
 */

import { JSONSchema } from "../json-schema";
import { EvalContext } from "../sandbox/sandbox";
import debug from "debug";
import { google } from "googleapis";
import { AuthError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { getGoogleCredentials, createGoogleOAuthClient, classifyGoogleApiError } from "./google-common";
import { defineTool, Tool } from "./types";

const debugSheets = debug("agent:gsheets");

const SUPPORTED_METHODS = [
  "spreadsheets.get",
  "spreadsheets.create",
  "spreadsheets.values.get",
  "spreadsheets.values.update",
  "spreadsheets.values.append",
  "spreadsheets.values.clear",
  "spreadsheets.values.batchGet",
  "spreadsheets.values.batchUpdate",
  "spreadsheets.batchUpdate",
] as const;

const READ_METHODS = new Set<string>([
  "spreadsheets.get",
  "spreadsheets.values.get",
  "spreadsheets.values.batchGet",
]);

// Methods that should trigger event tracking (write operations)
// Uses explicit Set membership instead of includes() to avoid false positives (spec: fix-google-tools-event-tracking-pattern)
const TRACKED_METHODS = new Set<string>([
  "spreadsheets.create",
  "spreadsheets.values.update",
  "spreadsheets.values.append",
  "spreadsheets.values.clear",
  "spreadsheets.values.batchUpdate",
  "spreadsheets.batchUpdate",
]);

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    method: {
      enum: SUPPORTED_METHODS as unknown as string[],
      description: "Google Sheets API method to call",
    },
    params: {
      description: "Parameters to pass to the Google Sheets API method",
    },
    account: {
      type: "string",
      description:
        "Email address of the Google Sheets account to use (e.g., user@gmail.com)",
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
 * Create Google Sheets tool that uses ConnectionManager for credentials.
 *
 * The tool requires an explicit `account` parameter (email address) to specify
 * which Google Sheets account to use. This prevents accidental account mixing in
 * multi-account setups.
 */
export function makeGSheetsTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool<Input, unknown> {
  return defineTool({
    namespace: "GoogleSheets",
    name: "api",
    outputType: "row",
    description: `Access Google Sheets API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. Mutation methods (only usable in 'mutate' handler): ${SUPPORTED_METHODS.filter(m => !READ_METHODS.has(m)).join(", ")}. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the email address of the connected Google Sheets account.`,
    inputSchema,
    isReadOnly: (params) => READ_METHODS.has(params.method),
    execute: async (input) => {
      const { method, params = {}, account } = input;

      const creds = await getGoogleCredentials(
        connectionManager,
        "gsheets",
        account,
        "GoogleSheets.api"
      );

      const connectionId = { service: "gsheets", accountId: account };

      debugSheets("Calling Google Sheets API", {
        method,
        account,
        params,
      });

      try {
        const oAuth2Client = createGoogleOAuthClient(creds);
        const sheets = google.sheets({ version: "v4", auth: oAuth2Client });

        let result;
        switch (method) {
          case "spreadsheets.get":
            result = await sheets.spreadsheets.get(params);
            break;
          case "spreadsheets.create":
            result = await sheets.spreadsheets.create(params);
            break;
          case "spreadsheets.values.get":
            result = await sheets.spreadsheets.values.get(params);
            break;
          case "spreadsheets.values.update":
            result = await sheets.spreadsheets.values.update(params);
            break;
          case "spreadsheets.values.append":
            result = await sheets.spreadsheets.values.append(params);
            break;
          case "spreadsheets.values.clear":
            result = await sheets.spreadsheets.values.clear(params);
            break;
          case "spreadsheets.values.batchGet":
            result = await sheets.spreadsheets.values.batchGet(params);
            break;
          case "spreadsheets.values.batchUpdate":
            result = await sheets.spreadsheets.values.batchUpdate(params);
            break;
          case "spreadsheets.batchUpdate":
            result = await sheets.spreadsheets.batchUpdate(params);
            break;
          default:
            throw new Error(`Method ${method} not implemented`);
        }

        // Track significant operations for auditing (spec: fix-google-tools-event-tracking-pattern)
        // Don't spam events with 'get' which usually happen in batches
        if (TRACKED_METHODS.has(method))
          await getContext().createEvent("gsheets_api_call", {
            method,
            account,
            params,
          });

        debugSheets("Google Sheets API call completed", { method, account, success: true });

        return result.data;
      } catch (error) {
        debugSheets("Google Sheets API call failed", {
          method,
          account,
          error: error instanceof Error ? error.message : String(error),
        });

        // Classify the error based on Google API response
        const classified = classifyGoogleApiError(error, "GoogleSheets.api", "gsheets", account);

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
