import { useEffect, useMemo, useRef } from "react";
import { useChatEvents } from "../hooks/dbChatReads";
import { useAddMessage, useReadChat } from "../hooks/dbWrites";
import { MessageItem } from "../ui/components/ai-elements/message-item";
import { TaskEventGroup } from "./TaskEventGroup";
import { EventType, EventPayload } from "../types/events";
import { AssistantUIMessage } from "@app/proto";
import type { UseMutationResult } from "@tanstack/react-query";
import React from "react";

interface ChatInterfaceProps {
  chatId?: string;
  promptHeight?: number;
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

export default function ChatInterface({ chatId: propChatId, promptHeight }: ChatInterfaceProps) {
  const chatId = propChatId || "main";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: events = [], isLoading } = useChatEvents(chatId);
  const addMessage = useAddMessage();
  const readChat = useReadChat();

  // Only re-create the status string when needed
  const status = useMemo(() => (addMessage.isPending ? "streaming" : "ready"), [addMessage.isPending]);

  // Group consecutive events by task_id, respecting message boundaries
  const organizedItems = useMemo(() => {
    const items: Array<{
      type: 'message' | 'task_group';
      data: any;
      timestamp: string;
      key: string;
    }> = [];

    // Sort all events chronologically first
    const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let currentTaskGroup: typeof sortedEvents = [];
    let currentTaskId: string | null = null;
    let groupCounter = 0;

    const flushCurrentGroup = () => {
      if (currentTaskGroup.length > 0 && currentTaskId) {
        items.push({
          type: 'task_group',
          data: { taskId: currentTaskId, events: currentTaskGroup },
          timestamp: currentTaskGroup[0].timestamp,
          key: `task-group-${currentTaskId}-${groupCounter++}`
        });
        currentTaskGroup = [];
        currentTaskId = null;
      }
    };

    sortedEvents.forEach(event => {
      if (event.type === 'message') {
        // Message breaks any current task group
        flushCurrentGroup();
        
        // Add the message
        const message = event.content as AssistantUIMessage;
        items.push({
          type: 'message',
          data: message,
          timestamp: event.timestamp,
          key: `message-${event.id}`
        });
      } else {
        // Non-message event
        const taskId = event.content?.task_id;
        
        if (!taskId) return; // Skip events without task_id
        
        if (currentTaskId === taskId) {
          // Same task, add to current group (including task_run events for grouping)
          currentTaskGroup.push(event);
        } else {
          // Different task, flush current group and start new one
          flushCurrentGroup();
          currentTaskId = taskId;
          currentTaskGroup = [event];
        }
      }
    });

    // Flush any remaining group
    flushCurrentGroup();

    return items;
  }, [events]);

  // Scroll to bottom when organized items change
  useEffect(() => {
    if (organizedItems.length > 0) {
      // Use 'auto' for large jumps to avoid long smooth scrolls on big histories
      messagesEndRef.current?.scrollIntoView({ behavior: organizedItems.length < 50 ? "smooth" : "auto" });
    }
  }, [organizedItems]);

  // Scroll to bottom when prompt height changes significantly (input expands)
  useEffect(() => {
    if (promptHeight && organizedItems.length > 0) {
      // Small delay to ensure layout has updated
      const timeoutId = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [promptHeight, organizedItems.length]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-center">
        <div>Loading messages...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6">
      {organizedItems.map((item, index) => {
        if (item.type === 'message') {
          // Render message
          return (
            <MessageItem
              key={item.key}
              message={item.data}
              status={index === organizedItems.length - 1 ? status : "ready"}
              isLastMessage={index === organizedItems.length - 1}
              full={false}
            />
          );
        } else {
          // Render task event group
          return (
            <TaskEventGroup
              key={item.key}
              taskId={item.data.taskId}
              events={item.data.events}
            />
          );
        }
      })}
      <div ref={messagesEndRef} />
      <ScrollToBottomDetector chatId={chatId} readChat={readChat} />
    </div>
  );
}
