import { useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useChatRows } from "../hooks/useChatRows";
import { useAddMessage, useReadChat } from "../hooks/dbWrites";
import { MessageItem } from "../ui/components/ai-elements/message-item";
import { TaskEventGroup } from "./TaskEventGroup";
import { WorkflowEventGroup } from "./WorkflowEventGroup";
import { AuthEventItem } from "./AuthEventItem";
import type { UseMutationResult } from "@tanstack/react-query";
import React from "react";

// Helper to get sessionStorage key for scroll position
const getScrollStorageKey = (chatId: string) => `chat-scroll-${chatId}`;

interface ChatInterfaceProps {
  chatId?: string;
  promptHeight?: number;
}

type ReadChatMutation = UseMutationResult<
  boolean,
  Error,
  { chatId: string },
  unknown
>;

/**
 * Detects when the user is near the bottom of the page and marks the chat as read.
 * Uses a single ref object to track mutable state without causing re-renders.
 */
const ScrollToBottomDetector = React.memo(function ScrollToBottomDetector({
  chatId,
  readChat,
  bottomThreshold = 30,
}: {
  chatId: string;
  readChat: ReadChatMutation;
  bottomThreshold?: number;
}) {
  // Single ref object for all mutable values - updated synchronously on render
  const stateRef = useRef({ chatId, mutate: readChat.mutate, isPending: readChat.isPending });
  stateRef.current = { chatId, mutate: readChat.mutate, isPending: readChat.isPending };

  // Throttling via requestAnimationFrame
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = document.documentElement;

    const checkBottomAndMarkRead = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      const isAtBottom = scrollHeight - (scrollTop + clientHeight) <= bottomThreshold;
      const { chatId, mutate, isPending } = stateRef.current;

      if (isAtBottom && chatId && !isPending) {
        mutate({ chatId });
      }
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        checkBottomAndMarkRead();
      });
    };

    const onVisibilityChange = () => {
      const { chatId, mutate, isPending } = stateRef.current;
      if (!document.hidden && chatId && !isPending) {
        mutate({ chatId });
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    checkBottomAndMarkRead(); // Run once on mount

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bottomThreshold]);

  return null;
});

export default function ChatInterface({
  chatId: propChatId,
  promptHeight,
}: ChatInterfaceProps) {
  const chatId = propChatId || "main";
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const { rows, isLoading, fetchNextPage, hasNextPage, isFetching, hasData } =
    useChatRows(chatId);

  const addMessage = useAddMessage();
  const readChat = useReadChat();

  // Only re-create the status string when needed
  const status = addMessage.isPending ? "streaming" : "ready";

  // Smart scroll-to-bottom logic
  const lastTimestampRef = useRef<string | null>(null);
  const currentScrollFromBottom = useRef<number | null>(null);
  const wasAtBottomRef = useRef(true); // Start assuming at bottom
  const isFirstLoadRef = useRef(true);
  // Track if we should restore scroll position instead of scroll-to-bottom
  const shouldRestoreScrollRef = useRef(false);
  const restoredScrollRef = useRef(false);
  // const isLoadingMoreRef = useRef(false);

  // Check for saved scroll position on mount - runs before first load effect
  useEffect(() => {
    const storageKey = getScrollStorageKey(chatId);
    const savedPosition = sessionStorage.getItem(storageKey);

    if (savedPosition) {
      const position = parseInt(savedPosition, 10);
      if (!isNaN(position)) {
        shouldRestoreScrollRef.current = true;
        // Don't clear yet - we clear after restoring
      }
    }
  }, [chatId]);

  // Save scroll position when navigating away (cleanup runs on route change)
  useEffect(() => {
    const storageKey = getScrollStorageKey(chatId);

    return () => {
      const scrollTop = document.documentElement.scrollTop;
      sessionStorage.setItem(storageKey, String(scrollTop));
    };
  }, [chatId, location.pathname]);

  // Track scroll position to know if user is at bottom and remember distance from bottom
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const { scrollTop, clientHeight, scrollHeight } = el;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Store to use it when restoring scroll cursor
      currentScrollFromBottom.current = distanceFromBottom;

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
      if (isFetching || !hasData) return; // isLoadingMoreRef.current
      const el = document.documentElement;
      const { scrollTop } = el;

      // When scrolled near the top, load more messages
      if (scrollTop < 200 && hasNextPage && !isFetching) {
        fetchNextPage().catch((e) => {
          console.error("Error loading", e);
        });
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasNextPage, fetchNextPage, isFetching, hasData]);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth") => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior,
    });
  }, []);

  // Smart scroll logic - handles first load, scroll restoration, and new messages
  useEffect(() => {
    if (!hasData || isFetching) return;

    // First load - check if we should restore scroll position or scroll to bottom
    if (isFirstLoadRef.current && rows.length > 0) {
      isFirstLoadRef.current = false;
      lastTimestampRef.current = lastMessageTimestamp;

      // Check if we should restore scroll position from sessionStorage
      if (shouldRestoreScrollRef.current && !restoredScrollRef.current) {
        const storageKey = getScrollStorageKey(chatId);
        const savedPosition = sessionStorage.getItem(storageKey);

        if (savedPosition) {
          const position = parseInt(savedPosition, 10);
          if (!isNaN(position)) {
            // Restore saved position
            window.scrollTo({ top: position, behavior: "auto" });
            // Clear saved position after restoring
            sessionStorage.removeItem(storageKey);
            // Mark as restored and update wasAtBottom based on restored position
            restoredScrollRef.current = true;
            shouldRestoreScrollRef.current = false;
            // Check if restored position is at bottom
            const el = document.documentElement;
            const distanceFromBottom = el.scrollHeight - (position + el.clientHeight);
            wasAtBottomRef.current = distanceFromBottom <= 30;
            return;
          }
        }
      }

      // No saved position to restore - scroll to bottom as before
      scrollToBottom("auto");
      return;
    }

    // Check if we have a new message (timestamp comparison)
    const hasNewMessage =
      lastMessageTimestamp &&
      lastTimestampRef.current &&
      lastMessageTimestamp > lastTimestampRef.current;

    // Only scroll if we have new message AND user was at bottom
    if (hasNewMessage) {
      // NOTE: if were down - scroll to show it,
      // otherwise don't touch scrollTop to keep position
      if (wasAtBottomRef.current) scrollToBottom("smooth");
    } else if (currentScrollFromBottom.current) {
      const { clientHeight: newClientHeight, scrollHeight: newScrollHeight } =
        document.documentElement;
      const targetScrollTop =
        newScrollHeight - newClientHeight - currentScrollFromBottom.current;
      document.documentElement.scrollTop = targetScrollTop;
    }

    // Update last timestamp
    if (lastMessageTimestamp) {
      lastTimestampRef.current = lastMessageTimestamp;
    }
    // scrollToBottom and chatId dependencies
  }, [hasData, lastMessageTimestamp, rows.length, isFetching, chatId, scrollToBottom]);

  // Pin-to-bottom using ResizeObserver - keeps user at bottom when content expands
  // (images loading, markdown rendering, etc.) without relying on scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Track the last height so we can detect growth vs shrinkage
    // Use document.documentElement for consistent height measurement across resize callbacks
    let lastHeight = document.documentElement.scrollHeight;

    const observer = new ResizeObserver(() => {
      // Only act if user was already at bottom before content changed
      if (!wasAtBottomRef.current) return;

      const newHeight = document.documentElement.scrollHeight;

      // Content grew - scroll to stay at bottom
      if (newHeight > lastHeight) {
        scrollToBottom("auto");
      }

      lastHeight = newHeight;
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Reset state when chatId changes
  useEffect(() => {
    isFirstLoadRef.current = true;
    lastTimestampRef.current = null;
    wasAtBottomRef.current = true;
    // isLoadingMoreRef.current = false;
    currentScrollFromBottom.current = 0;
    // Reset scroll restoration flags for new chat
    shouldRestoreScrollRef.current = false;
    restoredScrollRef.current = false;
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
            {isFetching
              ? "Loading older messages..."
              : "Scroll up to load older messages"}
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
          } else if (row.type === "task_group") {
            return (
              <TaskEventGroup
                key={row.id}
                taskId={row.data.taskId}
                events={row.data.events}
              />
            );
          } else if (row.type === "workflow_group") {
            return (
              <WorkflowEventGroup
                key={row.id}
                workflowId={row.data.workflowId}
                scriptId={row.data.scriptId}
                scriptRunId={row.data.scriptRunId}
                events={row.data.events}
              />
            );
          }
          return null;
        })}
        {rows.length === 0 && hasData && (
          <div className="py-4 text-center text-gray-500">
            Beginning of conversation
          </div>
        )}

        {/* Auth notice - shows when authentication is required */}
        <AuthEventItem autoShowPopup={chatId === "main"} />
      </div>
      <ScrollToBottomDetector chatId={chatId} readChat={readChat} />
    </div>
  );
}
