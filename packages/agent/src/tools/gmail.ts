import { z } from "zod";
import { EvalContext } from "../sandbox/sandbox";
import debug from "debug";
import { google } from "googleapis";
import { AuthError, classifyGoogleApiError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { getGoogleCredentials, createGoogleOAuthClient } from "./google-common";
import { defineReadOnlyTool, Tool } from "./types";

const debugGmail = debug("agent:gmail");

const SUPPORTED_METHODS = [
  "users.messages.list",
  "users.messages.get",
  "users.messages.attachments.get",
  "users.history.list",
  "users.threads.get",
  "users.threads.list",
  "users.getProfile",
] as const;

const inputSchema = z.object({
  method: z.enum(SUPPORTED_METHODS).describe("Gmail API method to call"),
  params: z
    .any()
    .optional()
    .describe("Parameters to pass to the Gmail API method"),
  account: z
    .string()
    .describe(
      "Email address of the Gmail account to use (e.g., user@gmail.com)"
    ),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Create Gmail tool that uses ConnectionManager for credentials.
 *
 * The tool requires an explicit `account` parameter (email address) to specify
 * which Gmail account to use. This prevents accidental account mixing in
 * multi-account setups.
 *
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeGmailTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool<Input, unknown> {
  return defineReadOnlyTool({
    namespace: "Gmail",
    name: "api",
    description: `Access Gmail API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. For all methods that require userId param, it will be automatically set to 'me'. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the email address of the connected Gmail account.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    // Skip output schema since it's dynamic based on method
    execute: async (input) => {
      const { method, params = {}, account } = input;

      const creds = await getGoogleCredentials(
        connectionManager,
        "gmail",
        account,
        "Gmail.api"
      );

      const connectionId = { service: "gmail", accountId: account };

      // Ensure userId is always 'me' for methods that require it
      const processedParams = { ...params };
      if (method !== "users.getProfile") {
        processedParams.userId = "me";
      }

      debugGmail("Calling Gmail API", {
        method,
        account,
        params: processedParams,
      });

      try {
        const oAuth2Client = createGoogleOAuthClient(creds);
        const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

        // Call the appropriate method
        let result;
        switch (method) {
          case "users.messages.list":
            result = await gmail.users.messages.list(processedParams);
            break;
          case "users.messages.get":
            result = await gmail.users.messages.get(processedParams);
            break;
          case "users.messages.attachments.get":
            result = await gmail.users.messages.attachments.get(processedParams);
            break;
          case "users.history.list":
            result = await gmail.users.history.list(processedParams);
            break;
          case "users.threads.get":
            result = await gmail.users.threads.get(processedParams);
            break;
          case "users.threads.list":
            result = await gmail.users.threads.list(processedParams);
            break;
          case "users.getProfile":
            result = await gmail.users.getProfile({ userId: "me" });
            break;
          default:
            throw new Error(`Method ${method} not implemented`);
        }

        // Don't spam events with 'get' methods which usually happen in batches
        if (method.includes("list"))
          await getContext().createEvent("gmail_api_call", {
            method,
            account,
            params: processedParams,
          });

        debugGmail("Gmail API call completed", { method, account, success: true });

        return result.data;
      } catch (error) {
        debugGmail("Gmail API call failed", {
          method,
          account,
          error: error instanceof Error ? error.message : String(error),
        });

        // Classify the error based on Gmail API response
        const classified = classifyGoogleApiError(error, "Gmail.api");

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
