import { useMemo, useRef } from "react";
import { useChatEvents } from "./dbChatReads";
import { AssistantUIMessage } from "@app/proto";

export interface ChatRow {
  type: "message" | "task_group";
  data: any;
  timestamp: string;
  key: string;
  id: string;
}

export function useChatRows(chatId: string) {
  const {
    data,
    isLoading,
    isFetching,
    status,
    error,
    fetchNextPage,
    hasNextPage,
  } = useChatEvents(chatId);

  const lastItemCount = useRef<number>(0);

  const rows = useMemo<ChatRow[]>(() => {
    if (!data?.events) return [];

    // Events come in DESC order (newest first) from useChatEvents
    // We need to reverse them to chronological order (oldest first) for proper grouping
    const events = [...data.events].reverse();
    const items: ChatRow[] = [];

    let currentTaskGroup: typeof events = [];
    let currentTaskId: string | null = null;
    let groupCounter = 0;

    const flushCurrentGroup = () => {
      if (currentTaskGroup.length > 0 && currentTaskId) {
        const groupId = `task-group-${currentTaskId}-${groupCounter++}`;
        items.push({
          type: "task_group",
          data: { taskId: currentTaskId, events: currentTaskGroup },
          timestamp: currentTaskGroup[0].timestamp,
          key: groupId,
          id: groupId,
        });
        currentTaskGroup = [];
        currentTaskId = null;
      }
    };

    events.forEach((event) => {
      if (event.type === "message") {
        // Message breaks any current task group
        flushCurrentGroup();

        // Add the message
        const message = event.content as AssistantUIMessage;
        items.push({
          type: "message",
          data: message,
          timestamp: event.timestamp,
          key: `message-${event.id}`,
          id: event.id,
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

    // All new items were grouped into the last item?
    // UI won't be able to trigger another load bcs resulting
    // rows.length didn't change, so we force it here
    if (
      items.length &&
      items.length === lastItemCount.current &&
      hasNextPage &&
      !isLoading &&
      !isFetching
    ) {
      // Load next page automatically
      fetchNextPage().catch(() => {});
    }

    // Store
    lastItemCount.current = items.length;

    // Return items in chronological order (oldest first, newest last)
    // This is correct for chat UI: oldest messages at top, newest at bottom
    return items;
  }, [data?.events]);

  return {
    rows,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetching,
    status,
    error,
    hasData: !!data?.events && data.events.length > 0,
  };
}
