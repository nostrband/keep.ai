"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageList } from "@/components/ai-elements/message-list";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  // PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { useChatEvents } from "@/lib/client/sse-hub";
import { DefaultChatTransport } from "ai";
import { notificationSound } from "@/lib/client/notification-sound";
import { AssistantUIMessage } from "@/ai/agent";

interface ChatInterfaceProps {
  id: string;
  initialMessages: AssistantUIMessage[];
}

export default function ChatInterface({
  id,
  initialMessages,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const lastProcessedMessageId = useRef<number>(0);
  const isInitialMount = useRef<boolean>(true);

  const { messages, status, sendMessage, regenerate, setMessages } = useChat({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Send ONLY the newest message; server will reload history
      prepareSendMessagesRequest({ messages, id, trigger }) {
        return {
          body: {
            message: messages[messages.length - 1],
            id,
            regenerate: trigger === "regenerate-message",
          },
        };
      },
    }),
  });

  // Subscribe to chat message events
  const chatStore = useChatEvents();

  // Handle new chat messages for this specific chat
  useEffect(() => {
    if (chatStore.messages.length === 0) return;

    // Get the latest message
    const latestMessage = chatStore.messages[chatStore.messages.length - 1];
    if (!latestMessage?.data) return;

    // Skip if we've already processed this message
    if (latestMessage.id <= lastProcessedMessageId.current) return;

    // Only show notifications after initial mount
    if (
      !isInitialMount.current &&
      (!("document" in globalThis) ||
        globalThis.document?.visibilityState !== "visible" ||
        latestMessage.data.chatId !== id)
    ) {
      const payload = latestMessage.data.messages.at(-1) as AssistantUIMessage;
      if (payload.role !== "user") {
        // Play notification sound for new chat messages
        notificationSound?.play().catch((error) => {
          // Silently handle notification sound errors
          console.debug("Notification sound failed:", error);
        });

        if ("Notification" in window) {
          Notification.requestPermission().then((perm) => {
            if (perm !== "granted") return;
            const body = payload.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join(" ");
            new Notification("Assistant:", {
              body,
              tag: payload.id,
              silent: false,
            });
          });
        }
      }
    }

    // Only process messages for the current chat
    if (latestMessage.data.chatId !== id) return;

    console.log(
      "Processing new chat message for chat interface:",
      latestMessage.id
    );
    lastProcessedMessageId.current = latestMessage.id;

    try {
      const messageData = latestMessage.data;

      if (!messageData.messages || !Array.isArray(messageData.messages)) return;

      // Convert the new messages to the expected format
      const newMessages = messageData.messages as AssistantUIMessage[];

      // Check if any of these messages are not already in our current message list
      setMessages((currentMessages) => {
        const currentMessageIds = new Set(currentMessages.map((msg) => msg.id));
        const messagesToAdd: AssistantUIMessage[] = [];

        // Find messages that aren't already in our list
        for (const newMsg of newMessages) {
          if (!currentMessageIds.has(newMsg.id)) {
            messagesToAdd.push(newMsg);
          }
        }

        if (messagesToAdd.length === 0) {
          return currentMessages; // No new messages to add
        }

        // Merge and sort messages by creation time to maintain proper order
        const allMessages = [...currentMessages, ...messagesToAdd];
        allMessages.sort((a, b) => {
          const aTime = new Date(a.metadata!.createdAt).getTime();
          const bTime = new Date(b.metadata!.createdAt).getTime();
          return aTime - bTime;
        });

        return allMessages;
      });
    } catch (error) {
      console.error(
        "Error processing chat message event in chat interface:",
        error
      );
    }

    // Mark that we've completed the initial mount processing
    if (isInitialMount.current) {
      isInitialMount.current = false;
    }
  }, [chatStore.lastId, id, setMessages]);

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage({
      text: message.text || "Sent with attachments",
      files: message.files,
      metadata: {
        createdAt: new Date().toISOString(),
        threadId: id,
      },
    });
    setInput("");
  };

  const handleRegenerate = useCallback((messageId: string) => {
    regenerate({ messageId });
  }, [regenerate]);

  console.log("messages", messages);
  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        <Conversation className="h-full">
          <ConversationContent>
            <MessageList
              messages={messages}
              status={status}
              onRegenerate={handleRegenerate}
            />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput
          onSubmit={handleSubmit}
          className="mt-4"
          globalDrop
          multiple
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit disabled={!input && !status} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
}
