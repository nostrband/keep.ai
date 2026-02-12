/**
 * Google Drive tool for the Keep.AI agent.
 *
 * Provides access to Google Drive API for file management operations.
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

const debugDrive = debug("agent:gdrive");

const SUPPORTED_METHODS = [
  "files.list",
  "files.get",
  "files.create",
  "files.update",
  "files.delete",
  "files.copy",
  "files.export",
] as const;

const READ_METHODS = new Set<string>([
  "files.list",
  "files.get",
  "files.export",
]);

// Methods that should trigger event tracking (write operations only)
// Uses explicit Set membership instead of includes() to avoid false positives
// Note: files.list excluded - read operations don't need audit tracking
const TRACKED_METHODS = new Set<string>([
  "files.create",
  "files.update",
  "files.delete",
  "files.copy",
]);

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    method: {
      enum: SUPPORTED_METHODS as unknown as string[],
      description: "Google Drive API method to call",
    },
    params: {
      description: "Parameters to pass to the Google Drive API method",
    },
    account: {
      type: "string",
      description:
        "Email address of the Google Drive account to use (e.g., user@gmail.com)",
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
 * Create Google Drive tool that uses ConnectionManager for credentials.
 *
 * The tool requires an explicit `account` parameter (email address) to specify
 * which Google Drive account to use. This prevents accidental account mixing in
 * multi-account setups.
 */
export function makeGDriveTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool<Input, unknown> {
  return defineTool({
    namespace: "GoogleDrive",
    name: "api",
    outputType: "file",
    description: `Access Google Drive API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the email address of the connected Google Drive account.`,
    inputSchema,
    isReadOnly: (params) => READ_METHODS.has(params.method),
    execute: async (input) => {
      const { method, params = {}, account } = input;

      const creds = await getGoogleCredentials(
        connectionManager,
        "gdrive",
        account,
        "GoogleDrive.api"
      );

      const connectionId = { service: "gdrive", accountId: account };

      debugDrive("Calling Google Drive API", {
        method,
        account,
        params,
      });

      try {
        const oAuth2Client = createGoogleOAuthClient(creds);
        const drive = google.drive({ version: "v3", auth: oAuth2Client });

        let result;
        switch (method) {
          case "files.list":
            result = await drive.files.list(params);
            break;
          case "files.get":
            result = await drive.files.get(params);
            break;
          case "files.create":
            result = await drive.files.create(params);
            break;
          case "files.update":
            result = await drive.files.update(params);
            break;
          case "files.delete":
            result = await drive.files.delete(params);
            break;
          case "files.copy":
            result = await drive.files.copy(params);
            break;
          case "files.export":
            result = await drive.files.export(params);
            break;
          default:
            throw new Error(`Method ${method} not implemented`);
        }

        // Track significant operations for auditing (spec: fix-gdrive-event-tracking, fix-google-tools-event-tracking-pattern)
        // Don't spam events with 'get'/'export' which usually happen in batches
        if (TRACKED_METHODS.has(method))
          await getContext().createEvent("gdrive_api_call", {
            method,
            account,
            params,
          });

        debugDrive("Google Drive API call completed", { method, account, success: true });

        return result.data;
      } catch (error) {
        debugDrive("Google Drive API call failed", {
          method,
          account,
          error: error instanceof Error ? error.message : String(error),
        });

        // Classify the error based on Google API response
        const classified = classifyGoogleApiError(error, "GoogleDrive.api");

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
