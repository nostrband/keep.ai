/**
 * @deprecated Task tools are no longer part of the agent workflow.
 * This file is preserved for reference only.
 */
import { z } from "zod";
import { tool } from "ai";
import { KeepDbApi } from "@app/db";
import { EvalContext } from "../../sandbox/sandbox";

export function makeTaskUpdateTool(
  api: KeepDbApi,
  getContext: () => EvalContext
) {
  return tool({
    description: `Update the current task's properties. Currently supports updating the title.
When updating a workflow task's title, the associated workflow's title is also updated.`,
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(500)
        .describe("New title for the task (1-500 characters)"),
    }),
    outputSchema: z.object({
      taskId: z.string().describe("ID of the updated task"),
      workflowUpdated: z.boolean().describe("Whether the associated workflow was also updated"),
    }),
    execute: async (params) => {
      const { title } = params;
      const context = getContext();
      const taskId = context.taskId;

      if (!taskId) {
        throw new Error("No task ID found in context");
      }

      let workflowUpdated = false;

      // Get the current task
      const task = await api.taskStore.getTask(taskId);
      
      // Try to find associated workflow outside the transaction
      let workflow = null;
      try {
        workflow = await api.scriptStore.getWorkflowByTaskId(taskId);
      } catch (error) {
        // No workflow associated with this task, that's ok
      }
      
      // Update task and workflow in one transaction
      await api.db.db.tx(async (tx) => {
        // Update the task title
        await api.taskStore.updateTask(
          {
            ...task,
            title,
          },
          tx
        );

        // Update associated workflow if exists
        if (workflow) {
          await api.scriptStore.updateWorkflow(
            {
              ...workflow,
              title,
            },
            tx
          );
          workflowUpdated = true;
        }
      });

      await context.createEvent("task_update", {
        task_id: taskId,
        title,
      });

      return {
        taskId,
        workflowUpdated,
      };
    },
  });
}
