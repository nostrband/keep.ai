import { z } from "zod";
import { tool } from "ai";
import { TaskStore } from "@app/db";

export function makeDeleteTaskTool(taskStore: TaskStore) {
  return tool({
    description:
      "Delete a task by its ID. Returns an error if the task doesn't exist.",
    inputSchema: z.object({
      id: z.string().describe("The ID of the task to delete"),
    }),
    execute: async (context) => {
      const { id } = context;

      try {
        // Check if task exists in database
        try {
          const task = await taskStore.getTask(id);
          if (!task) {
            return {
              success: false,
              error: "Task not found",
            };
          }
        } catch (error) {
          return {
            success: false,
            error: "Task not found",
          };
        }

        // Delete the task directly from the database
        await taskStore.deleteTask(id);

        return {
          success: true,
          message: `Task with ID '${id}' has been deleted successfully`,
          deleted_task_id: id,
        };
      } catch (error) {
        console.error("Error deleting task:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
