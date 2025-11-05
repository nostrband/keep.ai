import { useEffect, useMemo, useRef } from "react";
import { useChatMessages } from "../hooks/dbChatReads";
import { useAddMessage, useReadChat } from "../hooks/dbWrites";
import { MessageList } from "..//ui";
import type { UseMutationResult } from "@tanstack/react-query";
import React from "react";

interface ChatInterfaceProps {
  chatId?: string;
}

type ReadChatMutation = UseMutationResult<void, Error, { chatId: string }, unknown>;

/** Detects when the user is near the bottom of the page and marks the chat as read. */
const ScrollToBottomDetector = React.memo(function ScrollToBottomDetector({
  chatId,
  readChat,
  bottomThreshold = 30,
}: {
  chatId: string;
  readChat: ReadChatMutation;
  bottomThreshold?: number;
}) {
  // Keep latest values without retriggering effects
  const chatIdRef = useRef(chatId);
  const mutateRef = useRef(readChat.mutate);
  const pendingRef = useRef(readChat.isPending);

  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  useEffect(() => { mutateRef.current = readChat.mutate; }, [readChat.mutate]);
  useEffect(() => { pendingRef.current = readChat.isPending; }, [readChat.isPending]);

  // Throttling via rAF
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = document.documentElement;

    const checkBottomAndMarkRead = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      const isAtBottom = distanceFromBottom <= bottomThreshold;

      if (isAtBottom && chatIdRef.current && !pendingRef.current) {
        // console.log("isAtBottom", true);
        mutateRef.current({ chatId: chatIdRef.current });
      }
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        checkBottomAndMarkRead();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    // Run once on mount in case we land already at bottom
    checkBottomAndMarkRead();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
    };
    // Empty deps: attach once; use refs for latest values
  }, [bottomThreshold]);

  // Also mark as read when the tab becomes visible
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && chatIdRef.current && !pendingRef.current) {
        // console.log("visibilityChange");
        mutateRef.current({ chatId: chatIdRef.current });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return null;
});

export default function ChatInterface({ chatId: propChatId }: ChatInterfaceProps) {
  const chatId = propChatId || "main";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useChatMessages(chatId);
  const addMessage = useAddMessage();
  const readChat = useReadChat();

  // Only re-create the status string when needed
  const status = useMemo(() => (addMessage.isPending ? "streaming" : "ready"), [addMessage.isPending]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Use 'auto' for large jumps to avoid long smooth scrolls on big histories
      messagesEndRef.current?.scrollIntoView({ behavior: messages.length < 50 ? "smooth" : "auto" });
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
      <MessageList messages={messages} status={status} full={false} />
      <div ref={messagesEndRef} />
      <ScrollToBottomDetector chatId={chatId} readChat={readChat} />
    </div>
  );
}
