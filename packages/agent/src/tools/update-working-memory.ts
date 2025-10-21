import { z } from "zod";
import { tool } from "ai";
import { MemoryStore } from "@app/db";

export function makeUpdateWorkingMemoryTool(memoryStore: MemoryStore) {
  return tool({
    description: `Update the entire working memory content. This completely replaces the current working memory.
Use this tool sparingly - prefer 'patchWorkingMemory' for targeted updates to avoid losing important information.
Only use this when you need to completely restructure or rewrite the working memory.`,
    inputSchema: z.object({
      workingMemory: z
        .string()
        .describe(
          "The complete new working memory content to replace the existing one"
        ),
    }),
    execute: async (context) => {
      const { workingMemory } = context;

      try {
        // Set the complete working memory content
        await memoryStore.setResource(workingMemory);

        return {
          success: true,
          message: "Working memory updated successfully",
        };
      } catch (error) {
        console.error("Error updating working memory:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
