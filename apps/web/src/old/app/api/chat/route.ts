import { NextRequest, NextResponse } from "next/server";
import { convertToModelMessages, type UIMessage } from "ai";
import { createChat, updateChat } from "@/lib/server/chat-store";
import { USER_ID } from "@/lib/const";
import {
  getMessages,
  saveMessages,
  getThread,
  saveThread,
} from "@/lib/server/memory-store";
import { publishChatMessage } from "@/lib/server/events";
import { addCreatedAt } from "@/lib/utils";
import { makeAgent } from "@/ai/agent";
import { AssistantUIMessage } from "@/ai/agent";

const userId = USER_ID; // FIXME from auth info

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    console.error("Chat API error:", "Specify chat id");
    return new Response("Specify chat id", { status: 400 });
  }

  try {
    const messages = await getMessages({
      threadId: id,
      resourceId: USER_ID,
      limit: 50,
    });
    return NextResponse.json(messages);
  } catch {
    return NextResponse.json([]);
  }
}
export async function POST(req: NextRequest) {
  try {
    const {
      message,
      id,
      regenerate,
    }: { message: UIMessage; id: string; regenerate?: boolean } =
      await req.json();
    console.log(
      regenerate ? "regenerate" : "process",
      "message",
      JSON.stringify(message, null, 2)
    );

    // Get existing messages
    let originalMessages: AssistantUIMessage[] = [];
    try {
      const existingMessages = await getMessages({
        resourceId: userId,
        threadId: id,
        // Limit context size to 20 latest messages
        limit: 20,
      });
      originalMessages = existingMessages.filter(
        (m) => !regenerate || m.id !== message.id
      );
    } catch {}

    try {
      const now = new Date();

      // Ensure thread exists
      let thread = await getThread(id);
      if (!thread) {
        thread = {
          id,
          resourceId: userId,
          createdAt: now,
          updatedAt: now,
          title: "",
        };
        await saveThread(thread);
      }

      // Make user's message visible
      if (!originalMessages.length) {
        await createChat({
          userId: USER_ID,
          chatId: id,
          // user's message
          message,
        });
      } else {
        await updateChat({
          userId: USER_ID,
          chatId: id,
          updatedAt: now,
        });
      }

      // Publish chat message event
      await publishChatMessage({
        chatId: id,
        messages: addCreatedAt([message]),
        timestamp: now.toISOString(),
      });

      const agent = await makeAgent({
        mode: "user",
        threadId: id,
        userId,
        stepLimit: 10,
      });

      // Add user message with proper metadata
      const userMessage: AssistantUIMessage = {
        ...message,
        metadata: {
          createdAt: now.toISOString(),
          threadId: id,
          resourceId: userId,
        },
      };
      originalMessages.push(userMessage);
      console.log("originalMessages", JSON.stringify(originalMessages, null, 2));
      console.log("modelMessages", JSON.stringify(convertToModelMessages(originalMessages), null, 2));

      const stream = agent.stream({
        messages: convertToModelMessages(originalMessages),
      });

      // Stream is already in AI SDK v5 format
      return stream.toUIMessageStreamResponse({
        originalMessages,
        messageMetadata(options) {
          return {
            createdAt: new Date().toISOString(),
            threadId: id,
            resourceId: userId,
          };
        },
        onFinish: async ({ responseMessage }) => {
          try {
            const assistantMessage = responseMessage;

            const uiMessages = [userMessage, assistantMessage];

            // Save messages using our new method
            await saveMessages(uiMessages);

            // Publish agent's messages event
            await publishChatMessage({
              chatId: id,
              messages: addCreatedAt(uiMessages),
              timestamp: new Date().toISOString(),
            });
          } catch (error) {
            console.error("Error in onFinish callback:", error);
            throw new Error("Internal Server Error");
          }
        },
      });
    } catch (error) {
      console.error("Error during agent stream:", error);
      throw error;
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
