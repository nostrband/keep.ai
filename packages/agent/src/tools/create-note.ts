import { z } from "zod";
import { generateId, tool } from "ai";
import { NoteStore } from "@app/db";

export function makeCreateNoteTool(noteStore: NoteStore) {
  return tool({
    description: `Create a new note with title, content, tags, and priority.
ALWAYS check using searchNotesTool first if closely relevant note already exists and prefer updating existing one, only create new notes if no existing note fits or if asked explicitly by user.
Notes are useful for you (the assistant) to store project-specific information, reminders, ideas, or any other text-based content.
Tags help organize and categorize notes for easy retrieval later.
Maximum 500 notes, and title+content+tags size must not exceed 50KB.`,
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(500)
        .describe("Title of the note (1-500 characters)"),
      content: z.string().min(1).describe("Content/body of the note"),
      tags: z
        .array(z.string())
        .nullable()
        .default(null)
        .describe("Array of tags to categorize the note (optional)"),
      priority: z
        .enum(["low", "medium", "high"])
        .nullable()
        .default(null)
        .describe("Priority level of the note (optional, default: low)"),
    }),
    execute: async (context) => {
      const { title, content, tags, priority } = context;

      try {
        // Validate input and create note directly
        const finalTags = tags || [];
        const finalPriority = priority || "low";
        await noteStore.validateCreateNote(title, content, finalTags);

        // Generate ID for the note
        const noteId = generateId();

        // Create the note directly in the database
        await noteStore.createNote(
          title,
          content,
          finalTags,
          finalPriority,
          noteId
        );

        return {
          success: true,
          message: "Note created successfully",
          noteId: noteId,
        };
      } catch (error) {
        console.error("Error creating note:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
