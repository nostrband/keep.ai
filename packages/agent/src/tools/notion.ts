/**
 * Notion tool for the Keep.AI agent.
 *
 * Provides access to Notion API for database and page operations.
 * Requires explicit account parameter (workspace_id) for multi-account support.
 *
 * Notion tokens don't expire, so no refresh logic is needed.
 * Account ID is workspace_id (not email like Google services).
 */

import { z } from "zod";
import { Client } from "@notionhq/client";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import { AuthError, LogicError, classifyNotionError } from "../errors";
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

// Read-only methods (can be used outside Items.withItem)
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
        { source: toolName }
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

const inputSchema = z.object({
  method: z.enum(SUPPORTED_METHODS).describe("Notion API method to call"),
  params: z
    .any()
    .optional()
    .describe("Parameters to pass to the Notion API method"),
  account: z
    .string()
    .describe(
      "Workspace ID of the Notion workspace to use (from connected workspaces)"
    ),
});

type Input = z.infer<typeof inputSchema>;

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
    description: `Access Notion API with various methods. Supported methods: ${SUPPORTED_METHODS.join(", ")}. Returns dynamic results based on the method used. Knowledge of param and output structure is expected from the assistant. REQUIRED: 'account' parameter must be the workspace_id of the connected Notion workspace.

⚠️ MUTATION INFO:
- Read methods (can use outside Items.withItem): databases.query, databases.retrieve, pages.retrieve, blocks.children.list, search
- Write methods (MUST use inside Items.withItem): pages.create, pages.update, blocks.children.append`,
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
        const classified = classifyNotionError(error, "Notion.api");

        // If it's an auth error, mark the connection as errored
        if (classified instanceof AuthError) {
          await connectionManager.markError(connectionId, classified.message);
        }

        throw classified;
      }
    },
  }) as Tool<Input, unknown>;
}
