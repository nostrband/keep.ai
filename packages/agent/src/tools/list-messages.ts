import { z } from "zod";
import { MemoryStore } from "@app/db";

export function makeListMessagesTool(memoryStore: MemoryStore) {
  return {
    execute: async (opts?: { limit: number }) => {
      return await memoryStore.getMessages({
        // default limit
        limit: 3,
        // copy other options
        ...opts,
        // override thread
        threadId: "main",
      });
    },
    description:
      "Get list of recent messages exchanged with user, oldest-first.",
    inputSchema: z
      .object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of most recent user messages to fetch"),
      })
      .optional()
      .nullable(),
    outputSchema: z.array(
      z.object({
        id: z.string().describe("Id of message"),
        metadata: z.object({
          createdAt: z.string().describe("Date and time of message"),
        }),
        role: z
          .string()
          .describe("Message author's role - 'user' or 'assistant'"),
        parts: z.array(
          z.object({
            type: z.string().describe("Type of part, 'text' or others"),
            text: z.string().describe("Text of message part"),
          })
        ),
      })
    ),
  };
}
