/**
 * Tool list factories for creating tool arrays for different execution contexts.
 *
 * This module provides factory functions to create appropriate tool arrays
 * for workflow execution and task execution (planner/maintainer).
 *
 * @see exec-03a for the specification
 */
import { KeepDbApi } from "@app/db";
import type { ConnectionManager } from "@app/connectors";
import { EvalContext } from "./sandbox";
import { Tool } from "../tools/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

// Tool makers
import { makeConsoleLogTool } from "../tools/console-log";
import { makeGetWeatherTool } from "../tools/get-weather";
import { makeAtobTool } from "../tools/atob";
import { makeWebSearchTool } from "../tools/web-search";
import { makeWebFetchTool } from "../tools/web-fetch";
import { makeWebDownloadTool } from "../tools/web-download";
import { makeGetNoteTool } from "../tools/get-note";
import { makeListNotesTool } from "../tools/list-notes";
import { makeSearchNotesTool } from "../tools/search-notes";
import { makeCreateNoteTool } from "../tools/create-note";
import { makeUpdateNoteTool } from "../tools/update-note";
import { makeDeleteNoteTool } from "../tools/delete-note";
import { makeReadFileTool } from "../tools/read-file";
import { makeSaveFileTool } from "../tools/save-file";
import { makeListFilesTool } from "../tools/list-files";
import { makeSearchFilesTool } from "../tools/search-files";
import { makeImagesGenerateTool } from "../tools/images-generate";
import { makeImagesExplainTool } from "../tools/images-explain";
import { makeImagesTransformTool } from "../tools/images-transform";
import { makePdfExplainTool } from "../tools/pdf-explain";
import { makeAudioExplainTool } from "../tools/audio-explain";
import { makeTextExtractTool } from "../tools/text-extract";
import { makeTextClassifyTool } from "../tools/text-classify";
import { makeTextSummarizeTool } from "../tools/text-summarize";
import { makeTextGenerateTool } from "../tools/text-generate";
import { makeGmailTool } from "../tools/gmail";
import { makeGDriveTool } from "../tools/gdrive";
import { makeGSheetsTool } from "../tools/gsheets";
import { makeGDocsTool } from "../tools/gdocs";
import { makeNotionTool } from "../tools/notion";
import { makeUserSendTool, UserSendContext } from "../tools/user-send";
import { makeGetScriptTool } from "../tools/get-script";
import { makeListScriptsTool } from "../tools/list-scripts";
import { makeScriptHistoryTool } from "../tools/script-history";
import { makeListScriptRunsTool } from "../tools/list-script-runs";
import { makeGetScriptRunTool } from "../tools/get-script-run";
import { makeTopicsPeekTool, makeTopicsGetByIdsTool, makeTopicsPublishTool } from "../tools/topics";

/**
 * Configuration for creating tool lists.
 */
export interface ToolListConfig {
  /** Database API for accessing stores */
  api: KeepDbApi;
  /** Function to get current execution context */
  getContext: () => EvalContext;
  /** Connection manager for OAuth-based tools (Gmail, etc.) */
  connectionManager?: ConnectionManager;
  /** User file storage path */
  userPath?: string;
  /** Workflow ID (for Topics tools and user notifications) */
  workflowId?: string;
  /** Script run ID (for Topics.publish tracking) */
  scriptRunId?: string;
  /** Handler run ID (for Topics.publish tracking) */
  handlerRunId?: string;
}

/**
 * Create tool list for workflow/handler execution.
 *
 * Includes all tools needed for autonomous workflow execution:
 * - Console logging
 * - Utilities (weather, atob)
 * - Web (search, fetch, download)
 * - Memory (notes - CRUD)
 * - Files (read, save, list, search)
 * - Images, PDF, Audio processing
 * - Text processing
 * - Google services (when connectionManager provided)
 * - User notifications
 * - Topics API (event-driven execution)
 *
 * Excludes Scripts.* tools (introspection not needed in production workflows).
 *
 * @param config - Tool list configuration
 * @returns Array of Tool instances for workflow execution
 */
export function createWorkflowTools(config: ToolListConfig): AnyTool[] {
  const { api, getContext, connectionManager, userPath, workflowId, scriptRunId, handlerRunId } = config;

  // Create workflow ID and handler run ID getters for Topics tools
  const getWorkflowId = () => workflowId;
  const getHandlerRunId = () => handlerRunId || scriptRunId;

  // User send context for notifications
  const userSendContext: UserSendContext | undefined = workflowId
    ? {
        workflowId,
        workflowTitle: "", // Will be fetched by the tool if needed
        scriptRunId: scriptRunId || "",
      }
    : undefined;

  const tools: AnyTool[] = [
    // Console (always available)
    makeConsoleLogTool(getContext),

    // Utilities
    makeGetWeatherTool(getContext),
    makeAtobTool(),

    // Web
    makeWebSearchTool(getContext),
    makeWebFetchTool(getContext),
    makeWebDownloadTool(api.fileStore, userPath, getContext),

    // Memory - Notes (CRUD)
    makeGetNoteTool(api.noteStore),
    makeListNotesTool(api.noteStore),
    makeSearchNotesTool(api.noteStore),
    makeCreateNoteTool(api.noteStore, getContext),
    makeUpdateNoteTool(api.noteStore, getContext),
    makeDeleteNoteTool(api.noteStore, getContext),

    // Files
    makeReadFileTool(api.fileStore, userPath),
    makeSaveFileTool(api.fileStore, userPath, getContext),
    makeListFilesTool(api.fileStore),
    makeSearchFilesTool(api.fileStore),

    // Images
    makeImagesGenerateTool(api.fileStore, userPath, getContext),
    makeImagesExplainTool(api.fileStore, userPath, getContext),
    makeImagesTransformTool(api.fileStore, userPath, getContext),

    // PDF
    makePdfExplainTool(api.fileStore, userPath, getContext),

    // Audio
    makeAudioExplainTool(api.fileStore, userPath, getContext),

    // Text processing
    makeTextExtractTool(getContext),
    makeTextClassifyTool(getContext),
    makeTextSummarizeTool(getContext),
    makeTextGenerateTool(getContext),

    // User notifications
    makeUserSendTool(api, userSendContext),

    // Topics API (exec-03)
    makeTopicsPeekTool(api.eventStore, getWorkflowId, getHandlerRunId),
    makeTopicsGetByIdsTool(api.eventStore, getWorkflowId),
    makeTopicsPublishTool(api.eventStore, getWorkflowId, getHandlerRunId),
  ];

  // Add Google service tools if connection manager is available
  if (connectionManager) {
    tools.push(
      makeGmailTool(getContext, connectionManager),
      makeGDriveTool(getContext, connectionManager),
      makeGSheetsTool(getContext, connectionManager),
      makeGDocsTool(getContext, connectionManager),
      makeNotionTool(getContext, connectionManager)
    );
  }

  return tools;
}

/**
 * Create tool list for task execution (planner/maintainer).
 *
 * Includes all workflow tools plus Scripts.* tools for introspection:
 * - Scripts.get - Get script details
 * - Scripts.list - List all scripts
 * - Scripts.history - Get script version history
 * - Scripts.listScriptRuns - List script runs
 * - Scripts.getScriptRun - Get script run details
 *
 * @param config - Tool list configuration
 * @returns Array of Tool instances for task execution
 */
export function createTaskTools(config: ToolListConfig): AnyTool[] {
  const { api, getContext } = config;

  // Start with all workflow tools
  const tools = createWorkflowTools(config);

  // Add Scripts.* tools for planner/maintainer introspection
  tools.push(
    makeGetScriptTool(api.scriptStore, getContext),
    makeListScriptsTool(api.scriptStore),
    makeScriptHistoryTool(api.scriptStore),
    makeListScriptRunsTool(api.scriptStore, getContext),
    makeGetScriptRunTool(api.scriptStore)
  );

  return tools;
}
