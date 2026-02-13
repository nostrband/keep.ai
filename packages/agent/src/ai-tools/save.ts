import { JSONSchema } from "../json-schema";
import { AITool } from "./types";
import { Script, ScriptStore, ChatStore, CRSqliteDB, DBInterface } from "@app/db";
import { validateWorkflowScript, isWorkflowFormatScript, WorkflowConfig } from "../workflow-validator";
import { extractIntent } from "../intent-extract";
import debug from "debug";

const log = debug("save-tool");

export interface SaveInfo {
  code: string;
  title: string;
  comments?: string;
  summary?: string;
  diagram?: string;
}

const SaveInfoSchema: JSONSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "Script code to save" },
    title: { type: "string", description: "Title for the workflow/automation" },
    comments: { type: "string", description: "Comment for the code or code changes" },
    summary: { type: "string", description: "One-sentence description of what the automation does" },
    diagram: { type: "string", description: "Mermaid diagram source showing the automation flow (flowchart)" },
  },
  required: ["code", "title"],
};

// Result type for save tool
export interface SaveResult {
  script: Script;
}

/**
 * Create a save tool for the planner agent.
 *
 * The save tool ONLY creates a new script version. It does NOT activate the script
 * (set active_script_id, clear maintenance, update schedules, etc.).
 *
 * Exception: for draft→ready transition (first save), it sets status='ready' and
 * active_script_id since there's no separate activation step for initial creation.
 *
 * For subsequent saves, activation is handled separately:
 * - User clicks "Activate" button in UI
 * - Future: planner activation step
 */
export function makeSaveTool(opts: {
  taskId: string;
  taskRunId: string;
  chatId: string;
  scriptStore: ScriptStore;
  chatStore?: ChatStore;  // Optional: for intent extraction (exec-17)
  db?: CRSqliteDB;         // For transaction support
}) {
  return {
    execute: async (info: SaveInfo): Promise<SaveResult> => {
      // Validate workflow script structure if it uses the new workflow format (exec-05)
      // Old-format scripts (inline code) are not validated
      let workflowConfig: WorkflowConfig | undefined;
      if (isWorkflowFormatScript(info.code)) {
        const validation = await validateWorkflowScript(info.code);
        if (!validation.valid) {
          throw new Error(`Script validation failed: ${validation.error}`);
        }
        workflowConfig = validation.config;
      }

      const script = await opts.scriptStore.getLatestScriptByTaskId(
        opts.taskId
      );

      // Planner always increments major_version and resets minor_version to 0
      // This is the key distinction from maintainer's fix tool which only increments minor_version
      let majorVersion: number;
      let minorVersion: number;

      if (script) {
        // Increment major version, reset minor version
        majorVersion = script.major_version + 1;
        minorVersion = 0;
      } else {
        // First script starts at version 1.0
        majorVersion = 1;
        minorVersion = 0;
      }

      // Get workflow by task_id to link the script
      const workflow = await opts.scriptStore.getWorkflowByTaskId(opts.taskId);
      if (!workflow) {
        throw new Error(`Workflow not found for task ${opts.taskId}`);
      }

      const newScript: Script = {
        id: crypto.randomUUID(),
        code: info.code,
        change_comment: info.comments || "",
        task_id: opts.taskId,
        timestamp: new Date().toISOString(),
        major_version: majorVersion,
        minor_version: minorVersion,
        workflow_id: workflow.id,
        type: "",
        summary: info.summary || "",
        diagram: info.diagram || "",
      };

      const shouldUpdateTitle = info.title && (!workflow.title || workflow.title.trim() === '');

      const saveOps = async (tx?: DBInterface) => {
        await opts.scriptStore.addScript(newScript, tx);

        // Draft→ready transition: set status and active_script_id for initial creation
        if (workflow.status === 'draft') {
          const updates: { status: string; active_script_id: string; title?: string; handler_config?: string } = {
            status: 'ready',
            active_script_id: newScript.id,
          };
          if (shouldUpdateTitle) {
            updates.title = info.title;
          }
          if (workflowConfig) {
            updates.handler_config = JSON.stringify(workflowConfig);
          }
          await opts.scriptStore.updateWorkflowFields(workflow.id, updates, tx);
        } else {
          // Subsequent saves: only update title if needed
          // Do NOT set active_script_id — user must explicitly activate
          const updates: { title?: string } = {};
          if (shouldUpdateTitle) {
            updates.title = info.title;
          }
          if (Object.keys(updates).length > 0) {
            await opts.scriptStore.updateWorkflowFields(workflow.id, updates, tx);
          }
        }
      };

      if (opts.db) {
        await opts.db.db.tx(async (tx) => saveOps(tx));
      } else {
        await saveOps();
      }

      // Intent extraction (exec-17)
      // Extract intent from user messages on first major version (when no intent exists yet)
      // Run asynchronously to avoid blocking the save operation
      if (opts.chatStore && !workflow.intent_spec) {
        // Fire-and-forget intent extraction
        (async () => {
          try {
            log(`Extracting intent for workflow ${workflow.id}`);

            // Get user messages from the chat
            const messages = await opts.chatStore!.getNewChatMessages({ chatId: opts.chatId, limit: 100 });
            const userMessages = messages
              .filter((m: { role: string }) => m.role === "user")
              .map((m: { content: string }) => m.content)
              .filter((c: string) => c && c.trim());

            if (userMessages.length > 0) {
              const intentSpec = await extractIntent(userMessages, opts.taskId);
              const intentSpecJson = JSON.stringify(intentSpec);

              // Update workflow with extracted intent and optionally the title
              const intentUpdates: { intent_spec: string; title?: string } = {
                intent_spec: intentSpecJson,
              };

              // Use intent's title if workflow doesn't have one
              if (!workflow.title || workflow.title.trim() === '') {
                intentUpdates.title = intentSpec.title;
              }

              await opts.scriptStore.updateWorkflowFields(workflow.id, intentUpdates);
              log(`Intent extracted successfully for workflow ${workflow.id}: "${intentSpec.title}"`);
            }
          } catch (error) {
            // Log but don't fail the save operation
            log(`Intent extraction failed for workflow ${workflow.id}:`, error);
          }
        })();
      }

      return {
        script: newScript,
      };
    },
    description: `Save the new/updated script code with a workflow title, commit-style comments, summary, and optional flow diagram.
The title will only be applied if the workflow doesn't already have one.
The script will be saved as a new version. For the first save, the workflow will be activated automatically.
For subsequent saves, the user will need to activate the new version.
`,
    inputSchema: SaveInfoSchema,
  } satisfies AITool;
}
