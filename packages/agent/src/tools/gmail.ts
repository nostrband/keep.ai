import { z } from "zod";
import { tool } from "ai";
import { EvalContext } from "../sandbox/sandbox";
import debug from "debug";
import { google } from "googleapis";
import { AuthError, PermissionError, classifyGoogleApiError } from "../errors";

const debugGmail = debug("agent:gmail");

const SUPPORTED_METHODS = [
  "users.messages.list",
  "users.messages.get",
  "users.messages.attachments.get",
  "users.history.list",
  "users.threads.get",
  "users.threads.list",
  "users.getProfile"
] as const;

export function makeGmailTool(getContext: () => EvalContext, gmailOAuth2Client?: any) {
  return tool({
    description: `Access Gmail API with various methods. Supported methods: ${SUPPORTED_METHODS.join(', ')}. For all methods that require userId param, it will be automatically set to 'me'. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant.`,
    inputSchema: z.object({
      method: z.enum(SUPPORTED_METHODS).describe("Gmail API method to call"),
      params: z.any().optional().describe("Parameters to pass to the Gmail API method")
    }),
    // Skip output schema since it's dynamic based on method
    execute: async (input) => {
      const { method, params = {} } = input;

      // Ensure userId is always 'me' for methods that require it
      const processedParams = { ...params };
      if (method !== 'users.getProfile') {
        processedParams.userId = 'me';
      }

      debugGmail("Calling Gmail API", { method, params: processedParams });

      try {
        if (!gmailOAuth2Client) {
          throw new AuthError("Gmail OAuth client not available. Please connect your Gmail account.", { source: "Gmail.api" });
        }

        // Create Gmail API client
        const gmail = google.gmail({ version: "v1", auth: gmailOAuth2Client });

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
          await getContext().createEvent("gmail_api_call", { method, params: processedParams });
        
        debugGmail("Gmail API call completed", { method, success: true });
        
        return result.data;
      } catch (error) {
        debugGmail("Gmail API call failed", { method, error: error instanceof Error ? error.message : String(error) });
        // Classify the error based on Gmail API response
        throw classifyGoogleApiError(error, "Gmail.api");
      }
    },
  });
}