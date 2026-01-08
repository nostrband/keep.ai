import { z } from "zod";
import { tool } from "ai";
import { KeepDbApi } from "@app/db";
import { generateId } from "ai";

export function makeUserSendTool(api: KeepDbApi) {
  return tool({
    description: `Send a message to the user.
This is useful for scripts to send execution results to user.
The message will be saved as an assistant message with the current timestamp.`,
    inputSchema: z.object({
      message: z.string().describe("The message text to send to the user"),
    }),
    outputSchema: z.object({
      id: z.string().describe("Generated message ID"),
      success: z.boolean().describe("Whether the message was sent successfully"),
    }),
    execute: async (input) => {
      const message = {
        id: generateId(),
        role: "assistant" as const,
        metadata: {
          createdAt: new Date().toISOString(),
          threadId: "main",
        },
        parts: [
          {
            type: "text" as const,
            text: input.message,
          },
        ],
      };

      // Save to both tables in one transaction
      await api.db.db.tx(async (tx) => {
        await api.memoryStore.saveMessages([message], tx);
        await api.chatStore.saveChatMessages("main", [message], tx);
      });

      return {
        id: message.id,
        success: true,
      };
    },
  });
}
