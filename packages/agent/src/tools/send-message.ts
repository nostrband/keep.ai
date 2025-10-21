import { z } from "zod";
import { generateId, tool } from "ai";
import { AssistantUIMessage } from "@app/proto";
import { ChatStore, MemoryStore, StorageThreadType } from "@app/db";
import debug from "debug";

const debugSendMessage = debug("agent:send-message");

export function makeSendMessageTool(
  chatStore: ChatStore,
  memoryStore: MemoryStore,
  userId: string
) {
  return tool({
    description:
      "Send a message to the user. Prefer chat_id 'main' for all communications, unless you're sure a different chat_id is needed. ",
    inputSchema: z.object({
      content: z
        .union([
          z.string(),
          z.array(
            z.object({
              type: z.literal("text"),
              text: z
                .string()
                .describe("Textual content, plaintext or markdown"),
            })
          ),
          z.array(
            z.object({
              type: z.literal("file"),
              data: z.string().describe("URL or data-url format"),
              mimeType: z.string().describe("MIME type of the data"),
            })
          ),
        ])
        .describe("The assistant message content to send"),
      chat_id: z.string().describe("Required chat ID"),
    }),
    execute: async (context) => {
      const { content, chat_id } = context;

      try {
        // Get or create chat ID
        const chatId = chat_id || (await chatStore.createChatId());

        // Create assistant message in UI format
        const now = new Date();
        const parts =
          typeof content === "string"
            ? [{ type: "text" as const, text: content }]
            : content.map((part) => {
                if (part.type === "file") {
                  return {
                    type: "file" as const,
                    mediaType: part.mimeType,
                    url: part.data,
                  };
                }
                return {
                  type: "text" as const,
                  text: part.text,
                };
              });

        const uiMessage: AssistantUIMessage = {
          id: generateId(),
          role: "assistant",
          parts,
          metadata: {
            createdAt: now.toISOString(),
            threadId: chatId,
            resourceId: userId,
          },
        };

        debugSendMessage("send_message", uiMessage);

        // Get thread we're writing to
        let thread: StorageThreadType | null = null;
        if (chat_id) {
          thread = await memoryStore.getThread(chat_id);
          if (!thread || thread.resourceId !== userId)
            throw new Error("No such thread");
        }

        // Save directly to database and memory
        if (thread) {
          await memoryStore.saveThread({
            ...thread,
            updatedAt: now,
          });

          await chatStore.updateChat({
            chatId,
            updatedAt: now,
          });
        } else {
          await memoryStore.saveThread({
            id: chatId,
            createdAt: now,
            resourceId: userId,
            updatedAt: now,
            title: "",
          });

          await chatStore.createChat({
            chatId,
            message: uiMessage,
          });
        }

        // Save message to memory
        await memoryStore.saveMessages([uiMessage]);

        // TODO: Publish event for real-time notifications if needed
        // await publishChatMessage({
        //   chatId,
        //   messages: [uiMessage],
        //   timestamp: now.toISOString(),
        //   source: "send-message-tool",
        // });

        return {
          success: true,
          chat_id: chatId,
          message_id: uiMessage.id,
          message: "Message sent successfully",
        };
      } catch (error) {
        console.error("Error sending message:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
