/**
 * Notion tool for the Keep.AI agent.
 *
 * Provides access to Notion API for database and page operations.
 * Requires explicit account parameter (workspace_id) for multi-account support.
 *
 * Notion tokens don't expire, so no refresh logic is needed.
 * Account ID is workspace_id (not email like Google services).
 */

import { JSONSchema } from "../json-schema";
import { Client } from "@notionhq/client";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import {
  AuthError,
  LogicError,
  PermissionError,
  NetworkError,
  InternalError,
  classifyHttpError,
  type ClassifiedError,
} from "../errors";
import type { ConnectionManager, Connection, OAuthCredentials } from "@app/connectors";
import { defineTool, Tool } from "./types";

const debugNotion = debug("agent:notion");

const SUPPORTED_METHODS = [
  "databases.query",
  "databases.retrieve",
  "pages.retrieve",
  "pages.create",
  "pages.update",
  "blocks.children.list",
  "blocks.children.append",
  "search",
] as const;

type NotionMethod = (typeof SUPPORTED_METHODS)[number];

const READ_METHODS = new Set<string>([
  "databases.query",
  "databases.retrieve",
  "pages.retrieve",
  "blocks.children.list",
  "search",
]);

/**
 * Get credentials for Notion, with proper error handling.
 *
 * Unlike Google services, Notion uses workspace_id as the account identifier.
 * The display name (workspace_name) is shown in error messages for better UX.
 */
async function getNotionCredentials(
  connectionManager: ConnectionManager,
  accountId: string | undefined,
  toolName: string
): Promise<OAuthCredentials> {
  if (!accountId) {
    const connections = await connectionManager.listConnectionsByService("notion");
    if (connections.length === 0) {
      throw new AuthError(
        "Notion not connected. Please connect a Notion workspace in Settings.",
        { source: toolName, serviceId: "notion", accountId: "" }
      );
    }
    // Show workspace names for better UX
    const accountList = connections
      .map((c: Connection) => {
        const name = c.metadata?.workspace_name || c.accountId;
        return name !== c.accountId ? `${name} (${c.accountId})` : c.accountId;
      })
      .join(", ");
    throw new LogicError(
      `Notion account required. Available workspaces: ${accountList}`,
      { source: toolName }
    );
  }

  const connectionId = { service: "notion", accountId };
  return connectionManager.getCredentials(connectionId);
}

/**
 * Classify a Notion API error into a typed ClassifiedError.
 *
 * Notion API error structure:
 * - status: HTTP status code
 * - code: Notion error code (e.g., "unauthorized", "restricted_resource", "object_not_found")
 * - message: Human-readable error message
 *
 * @param err The Notion API error
 * @param source The tool that made the API call
 * @param serviceId The connector service ID ("notion")
 * @param accountId The account identifier (workspace_id)
 */
function classifyNotionError(
  err: any,
  source: string,
  serviceId: string,
  accountId: string
): ClassifiedError {
  // Notion API errors have status, code, and message
  const status = err?.status || err?.response?.status || err?.code;
  const notionCode = err?.code as string | undefined;
  const message = err?.message || err?.body?.message || String(err);

  // Handle Notion-specific error codes first (before HTTP status)
  if (notionCode) {
    switch (notionCode) {
      case 'unauthorized':
      case 'invalid_token':
        return new AuthError('Notion authentication failed. Please reconnect your workspace.', {
          cause: err, source, serviceId, accountId,
        });

      case 'restricted_resource':
        return new PermissionError('Notion access denied. The integration may not have access to this page or database.', { cause: err, source });

      case 'object_not_found':
        return new LogicError(`Notion resource not found: ${message}`, { cause: err, source });

      case 'validation_error':
      case 'invalid_json':
      case 'invalid_request':
      case 'invalid_request_url':
        return new LogicError(`Notion request error: ${message}`, { cause: err, source });

      case 'rate_limited':
        return new NetworkError('Notion rate limit exceeded. Please try again later.', { cause: err, source, statusCode: 429 });

      case 'internal_server_error':
      case 'service_unavailable':
        return new NetworkError(`Notion service error: ${message}`, { cause: err, source, statusCode: 500 });

      case 'conflict_error':
        return new LogicError(`Notion conflict: ${message}`, { cause: err, source });

      case 'database_connection_unavailable':
        return new NetworkError('Notion database temporarily unavailable. Please try again.', { cause: err, source });
    }
  }

  // Handle numeric HTTP status codes
  if (typeof status === 'number') {
    // Handle 401 explicitly — classifyHttpError doesn't create AuthError
    if (status === 401) {
      return new AuthError(`Notion authentication failed (401): ${message}`, {
        cause: err, source, serviceId, accountId,
      });
    }
    return classifyHttpError(status, message, { cause: err, source });
  }

  // Unrecognized error shape — internal error
  return new InternalError(`Unclassified Notion API error: ${message}`, {
    cause: err instanceof Error ? err : undefined, source,
  });
}

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    method: {
      enum: SUPPORTED_METHODS as unknown as string[],
      description: "Notion API method to call",
    },
    params: {
      description: "Parameters to pass to the Notion API method",
    },
    account: {
      type: "string",
      description:
        "Workspace ID of the Notion workspace to use (from connected workspaces)",
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
 * Create Notion tool that uses ConnectionManager for credentials.
 *
 * The tool requires an explicit `account` parameter (workspace_id) to specify
 * which Notion workspace to use. This prevents accidental workspace mixing in
 * multi-workspace setups.
 */
export function makeNotionTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool<Input, unknown> {
  return defineTool({
    namespace: "Notion",
    name: "api",
    outputType: "page",
    description: `Access Notion API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. Mutation methods (only usable in 'mutate' handler): ${SUPPORTED_METHODS.filter(m => !READ_METHODS.has(m)).join(", ")}. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the workspace_id of the connected Notion workspace.`,
    inputSchema,
    isReadOnly: (params) => READ_METHODS.has(params.method),
    execute: async (input) => {
      const { method, params = {}, account } = input;

      const creds = await getNotionCredentials(
        connectionManager,
        account,
        "Notion.api"
      );

      const connectionId = { service: "notion", accountId: account };

      debugNotion("Calling Notion API", {
        method,
        account,
        params,
      });

      try {
        const notion = new Client({
          auth: creds.accessToken,
        });

        let result;
        switch (method as NotionMethod) {
          case "databases.query":
            result = await notion.databases.query(params);
            break;
          case "databases.retrieve":
            result = await notion.databases.retrieve(params);
            break;
          case "pages.retrieve":
            result = await notion.pages.retrieve(params);
            break;
          case "pages.create":
            result = await notion.pages.create(params);
            break;
          case "pages.update":
            result = await notion.pages.update(params);
            break;
          case "blocks.children.list":
            result = await notion.blocks.children.list(params);
            break;
          case "blocks.children.append":
            result = await notion.blocks.children.append(params);
            break;
          case "search":
            result = await notion.search(params);
            break;
          default:
            throw new Error(`Method ${method} not implemented`);
        }

        // Track significant operations (not retrieves which happen in batches)
        if (
          method.includes("query") ||
          method.includes("create") ||
          method.includes("update") ||
          method.includes("append") ||
          method === "search"
        ) {
          await getContext().createEvent("notion_api_call", {
            method,
            account,
            params,
          });
        }

        debugNotion("Notion API call completed", { method, account, success: true });

        return result;
      } catch (error) {
        debugNotion("Notion API call failed", {
          method,
          account,
          error: error instanceof Error ? error.message : String(error),
        });

        // Classify the error based on Notion API response
        const classified = classifyNotionError(error, "Notion.api", "notion", account);

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
