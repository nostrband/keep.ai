import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeUpdateNoteTool(noteStore: NoteStore) {
  return tool({
    description: `Update an existing note by ID. You can modify title, content, tags, and/or priority.
Only the fields you specify will be updated - other fields remain unchanged.
Title+content+tags size must not exceed 50KB after update.`,
    inputSchema: z.object({
      noteId: z.string().min(1).describe("ID of the note to update"),
      title: z
        .string()
        .min(1)
        .max(500)
        .nullable()
        .describe("New title for the note (1-500 characters, optional)"),
      content: z
        .string()
        .min(1)
        .nullable()
        .describe("New content/body for the note (optional)"),
      tags: z
        .array(z.string())
        .nullable()
        .describe("New array of tags to categorize the note (optional)"),
      priority: z
        .enum(["low", "medium", "high"])
        .nullable()
        .describe("New priority level of the note (optional)"),
    }),
    execute: async (context) => {
      const { noteId, title, content, tags, priority } = context;

      try {
        // Prepare updates object
        const updates: {
          title?: string;
          content?: string;
          tags?: string[];
          priority?: "low" | "medium" | "high";
        } = {};
        if (title !== null) updates.title = title;
        if (content !== null) updates.content = content;
        if (tags !== null) updates.tags = tags;
        if (priority !== null) updates.priority = priority;

        if (Object.keys(updates).length === 0) {
          return {
            success: false,
            error: "No updates provided. Specify at least one field to update.",
          };
        }

        // Validate against database and get existing note
        const validationResult = await noteStore.validateUpdateNote(
          noteId,
          updates
        );
        const existing = validationResult.existing;

        // Prepare updated values
        const newTitle = validationResult.newTitle;
        const newContent = validationResult.newContent;
        const newTags = validationResult.newTags;
        const newPriority = validationResult.newPriority;

        // Update the note directly in the database
        await noteStore.updateNote(
          noteId,
          newTitle,
          newContent,
          newTags,
          newPriority,
          existing.created
        );

        return {
          success: true,
          message: "Note updated successfully",
          noteId: noteId,
        };
      } catch (error) {
        console.error("Error updating note:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
