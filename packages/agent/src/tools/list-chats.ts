import { z } from "zod";
import { tool } from "ai";
import { ChatStore } from "@app/db";

export function makeListChatsTool(chatStore: ChatStore) {
  return tool({
    description:
      "Get a list of all available chats to see existing conversations and their details",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const chats = await chatStore.getAllChats();

        return {
          success: true,
          chats: chats.map((chat) => ({
            id: chat.id,
            first_message: chat.first_message,
            first_message_time: chat.first_message_time,
            updated_at: chat.updated_at,
          })),
          total_count: chats.length,
        };
      } catch (error) {
        console.error("Error fetching chats:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          chats: [],
          total_count: 0,
        };
      }
    },
  });
}
