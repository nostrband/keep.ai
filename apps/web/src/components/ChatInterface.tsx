import { useEffect, useRef } from "react";
import { useChatMessages } from "../hooks/dbChatReads";
import { useAddMessage, useReadChat } from "../hooks/dbWrites";
import {
  MessageList,
} from "..//ui";
import type { UseMutationResult } from "@tanstack/react-query";

interface ChatInterfaceProps {
  chatId?: string;
}

// Component to detect when user scrolls to bottom and mark chat as read
function ScrollToBottomDetector({
  chatId,
  readChat
}: {
  chatId: string;
  readChat: UseMutationResult<void, Error, { chatId: string; userId?: string; }, unknown>;
}) {
  // Check if user is at bottom of page
  useEffect(() => {
    const handleScroll = () => {
      const isAtBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 100;
      if (isAtBottom && chatId) {
        readChat.mutate({ chatId });
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [chatId, readChat]);

  // Also mark as read when the component becomes visible (user navigates to chat)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && chatId) {
        readChat.mutate({ chatId });
        console.log("readChat on visibility");
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [chatId, readChat]);

  return null; // This component doesn't render anything
}

export default function ChatInterface({ chatId: propChatId }: ChatInterfaceProps) {
  const chatId = propChatId || "main";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useChatMessages(chatId);
  const addMessage = useAddMessage();
  const readChat = useReadChat();

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
        <div>Loading messages...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6">
      <MessageList
        messages={messages}
        status={addMessage.isPending ? "streaming" : "ready"}
        full={false}
      />
      <div ref={messagesEndRef} />
      <ScrollToBottomDetector chatId={chatId} readChat={readChat} />
    </div>
  );
}