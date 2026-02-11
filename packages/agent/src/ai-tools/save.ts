import { JSONSchema } from "../json-schema";
import { AITool } from "./types";
import { Script, ScriptStore, ChatStore, CRSqliteDB, DBInterface, ProducerScheduleStore } from "@app/db";
import { validateWorkflowScript, isWorkflowFormatScript } from "../workflow-validator";
import { extractIntent } from "../intent-extract";
import { updateProducerSchedules } from "../producer-schedule-init";
import { getMostFrequentProducerCron } from "../schedule-utils";
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

// Result type for save tool - includes script info and whether it was a maintenance fix
export interface SaveResult {
  script: Script;
  wasMaintenanceFix: boolean;
}

export function makeSaveTool(opts: {
  taskId: string;
  taskRunId: string;
  chatId: string;
  scriptStore: ScriptStore;
  chatStore?: ChatStore;  // Optional: for intent extraction (exec-17)
  db?: CRSqliteDB;         // For transaction support
  producerScheduleStore?: ProducerScheduleStore;  // For per-producer scheduling (exec-13)
}) {
  return {
    execute: async (info: SaveInfo): Promise<SaveResult> => {
      // Validate workflow script structure if it uses the new workflow format (exec-05)
      // Old-format scripts (inline code) are not validated
      if (isWorkflowFormatScript(info.code)) {
        const validation = await validateWorkflowScript(info.code);
        if (!validation.valid) {
          throw new Error(`Script validation failed: ${validation.error}`);
        }
        var workflowConfig = validation.config;
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

      // Check if workflow was in maintenance mode (agent auto-fix)
      const wasInMaintenance = workflow.maintenance;

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
      // Wrap script creation and all workflow field updates in a single transaction
      // to prevent the scheduler from executing old scripts between writes
      const shouldUpdateTitle = info.title && (!workflow.title || workflow.title.trim() === '');

      const saveOps = async (tx?: DBInterface) => {
        await opts.scriptStore.addScript(newScript, tx);

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
          const updates: { active_script_id: string; title?: string; handler_config?: string } = {
            active_script_id: newScript.id,
          };
          if (shouldUpdateTitle) {
            updates.title = info.title;
          }
          if (workflowConfig) {
            updates.handler_config = JSON.stringify(workflowConfig);
          }
          await opts.scriptStore.updateWorkflowFields(workflow.id, updates, tx);
        }

        // If workflow was in maintenance mode, clear it and trigger immediate re-run
        if (wasInMaintenance) {
          await opts.scriptStore.updateWorkflowFields(workflow.id, {
            maintenance: false,
            maintenance_fix_count: 0,
            next_run_timestamp: new Date().toISOString(),
          }, tx);
        }
      };

      if (opts.db) {
        await opts.db.db.tx(async (tx) => saveOps(tx));
      } else {
        await saveOps();
      }

      // Initialize/update per-producer schedules (exec-13)
      if (workflowConfig && opts.producerScheduleStore) {
        try {
          await updateProducerSchedules(workflow.id, workflowConfig, opts.producerScheduleStore);
          // Denormalize schedule info to workflow for display
          const cron = getMostFrequentProducerCron(workflowConfig.producers);
          const nextRunAt = await opts.producerScheduleStore.getNextScheduledTime(workflow.id);
          await opts.scriptStore.updateWorkflowFields(workflow.id, {
            cron,
            next_run_timestamp: nextRunAt ? new Date(nextRunAt).toISOString() : '',
          });
        } catch (error) {
          log(`Failed to update producer schedules for workflow ${workflow.id}:`, error);
        }
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

      // Return both the script and whether this was a maintenance fix
      // The task-worker will use this to set message metadata
      return {
        script: newScript,
        wasMaintenanceFix: wasInMaintenance,
      };
    },
    description: `Save the new/updated script code with a workflow title, commit-style comments, summary, and optional flow diagram.
The title will only be applied if the workflow doesn't already have one.
`,
    inputSchema: SaveInfoSchema,
  } satisfies AITool;
}
