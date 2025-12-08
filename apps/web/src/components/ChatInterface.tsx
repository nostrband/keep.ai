import { useEffect, useRef, useCallback, useMemo } from "react";
import { useChatRows } from "../hooks/useChatRows";
import { useAddMessage, useReadChat } from "../hooks/dbWrites";
import { MessageItem } from "../ui/components/ai-elements/message-item";
import { TaskEventGroup } from "./TaskEventGroup";
import type { UseMutationResult } from "@tanstack/react-query";
import React from "react";

interface ChatInterfaceProps {
  chatId?: string;
  promptHeight?: number;
}

type ReadChatMutation = UseMutationResult<
  void,
  Error,
  { chatId: string },
  unknown
>;

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

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);
  useEffect(() => {
    mutateRef.current = readChat.mutate;
  }, [readChat.mutate]);
  useEffect(() => {
    pendingRef.current = readChat.isPending;
  }, [readChat.isPending]);

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

export default function ChatInterface({
  chatId: propChatId,
  promptHeight,
}: ChatInterfaceProps) {
  const chatId = propChatId || "main";
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    rows,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    hasData,
  } = useChatRows(chatId);

  const addMessage = useAddMessage();
  const readChat = useReadChat();

  // Only re-create the status string when needed
  const status = addMessage.isPending ? "streaming" : "ready";

  // Smart scroll-to-bottom logic
  const lastTimestampRef = useRef<string | null>(null);
  const wasAtBottomRef = useRef(true); // Start assuming at bottom
  const isFirstLoadRef = useRef(true);
  const isLoadingMoreRef = useRef(false);

  // Track scroll position to know if user is at bottom and remember distance from bottom
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const { scrollTop, clientHeight, scrollHeight } = el;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      
      wasAtBottomRef.current = distanceFromBottom <= 30;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Get last message timestamp
  const lastMessageTimestamp = useMemo(() => {
    if (rows.length === 0) return null;
    const lastRow = rows[rows.length - 1];
    return lastRow.timestamp;
  }, [rows]);

  // Detect when we need to load more data (infinite scroll up for older messages)
  useEffect(() => {
    const onScroll = () => {
      if (isLoadingMoreRef.current || !hasData) return;
      const el = document.documentElement;
      const { scrollTop } = el;
      
      // When scrolled near the top, load more messages
      if (scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
        isLoadingMoreRef.current = true;
        
        // Remember scroll position from bottom before loading
        const { scrollTop: currentScrollTop, clientHeight, scrollHeight } = el;
        const currentScrollFromBottom = scrollHeight - (currentScrollTop + clientHeight);
        
        fetchNextPage().then(() => {
          // After loading, restore scroll position relative to bottom
          setTimeout(() => {
            const { clientHeight: newClientHeight, scrollHeight: newScrollHeight } = document.documentElement;
            const targetScrollTop = newScrollHeight - newClientHeight - currentScrollFromBottom;
            document.documentElement.scrollTop = targetScrollTop;
            isLoadingMoreRef.current = false;
          }, 50);
        });
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasNextPage, fetchNextPage, isFetchingNextPage, hasData]);

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth", onDone?: () => void) => {
      console.log("scroll", behavior);
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior,
      });
      
      // Ensure we're actually at the bottom after any dynamic content loads
      const int = setInterval(() => {
        const el = document.documentElement;
        const bottom = el.clientHeight + el.scrollTop;
        if (el.scrollHeight > bottom) {
          window.scrollTo(0, el.scrollHeight);
        } else {
          clearInterval(int);
          wasAtBottomRef.current = true;
          if (onDone) onDone();
        }
      }, 50);
    },
    []
  );

  // Smart scroll logic - handles first load and new messages
  useEffect(() => {
    if (!hasData || isFetchingNextPage || isLoadingMoreRef.current) return;

    // First load - scroll to bottom immediately without animation
    if (isFirstLoadRef.current && rows.length > 0) {
      isFirstLoadRef.current = false;
      lastTimestampRef.current = lastMessageTimestamp;
      scrollToBottom("auto");
      return;
    }

    // Check if we have a new message (timestamp comparison)
    const hasNewMessage =
      lastMessageTimestamp &&
      lastTimestampRef.current &&
      lastMessageTimestamp > lastTimestampRef.current;

    // Only scroll if we have new message AND user was at bottom
    if (hasNewMessage && wasAtBottomRef.current) {
      scrollToBottom("smooth");
    }

    // Update last timestamp
    if (lastMessageTimestamp) {
      lastTimestampRef.current = lastMessageTimestamp;
    }
    
  }, [hasData, lastMessageTimestamp, rows.length, isFetchingNextPage, scrollToBottom]);

  // Reset first load flag when chatId changes
  useEffect(() => {
    isFirstLoadRef.current = true;
    lastTimestampRef.current = null;
    wasAtBottomRef.current = true;
    isLoadingMoreRef.current = false;
  }, [chatId]);

  if (isLoading && !hasData) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
        <div>Loading messages...</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="max-w-4xl mx-auto">
      <div className="px-6">
        {hasNextPage && (
          <div className="py-4 text-center text-gray-500">
            {isFetchingNextPage ? "Loading older messages..." : "Scroll up to load older messages"}
          </div>
        )}
        {rows.map((row, index) => {
          if (row.type === "message") {
            return (
              <MessageItem
                key={row.id}
                message={row.data}
                status={index === rows.length - 1 ? status : "ready"}
                isLastMessage={index === rows.length - 1}
                full={false}
              />
            );
          } else {
            return (
              <TaskEventGroup
                key={row.id}
                taskId={row.data.taskId}
                events={row.data.events}
              />
            );
          }
        })}
        {rows.length === 0 && hasData && (
          <div className="py-4 text-center text-gray-500">
            Beginning of conversation
          </div>
        )}
      </div>
      <ScrollToBottomDetector chatId={chatId} readChat={readChat} />
    </div>
  );
}
