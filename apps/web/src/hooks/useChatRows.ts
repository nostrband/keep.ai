import { useMemo, useRef } from "react";
import { useChatEvents } from "./dbChatReads";
import { AssistantUIMessage, ChatAgentEvent } from "@app/proto";

export interface ChatRow {
  type: "message" | "task_group" | "workflow_group";
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
    let currentTaskRunId: string | null = null;
    let currentWorkflowGroup: typeof events = [];
    let currentScriptRunId: string | null = null;
    let groupCounter = 0;

    const flushCurrentTaskGroup = () => {
      if (currentTaskGroup.length > 0 && currentTaskRunId) {
        const taskId = (currentTaskGroup[0].content as ChatAgentEvent).task_id;
        const groupId = `task-group-${currentTaskRunId}-${groupCounter++}`;
        items.push({
          type: "task_group",
          data: { taskId, events: currentTaskGroup },
          timestamp: currentTaskGroup[0].timestamp,
          key: groupId,
          id: groupId,
        });
        currentTaskGroup = [];
        currentTaskRunId = null;
      }
    };

    const flushCurrentWorkflowGroup = () => {
      if (currentWorkflowGroup.length > 0 && currentScriptRunId) {
        const workflowId = (currentWorkflowGroup[0].content as ChatAgentEvent).workflow_id;
        const scriptId = (currentWorkflowGroup[0].content as ChatAgentEvent).script_id;
        const groupId = `workflow-group-${currentScriptRunId}-${groupCounter++}`;
        items.push({
          type: "workflow_group",
          data: { workflowId, scriptId, scriptRunId: currentScriptRunId, events: currentWorkflowGroup },
          timestamp: currentWorkflowGroup[0].timestamp,
          key: groupId,
          id: groupId,
        });
        currentWorkflowGroup = [];
        currentScriptRunId = null;
      }
    };

    events.forEach((event) => {
      if (event.type === "message") {
        // Message breaks any current groups
        flushCurrentTaskGroup();
        flushCurrentWorkflowGroup();

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
        const taskRunId = (event.content as ChatAgentEvent).task_run_id;
        const scriptRunId = (event.content as ChatAgentEvent).script_run_id;
        
        if (taskRunId) {
          // Has task_run_id, group by task run
          flushCurrentWorkflowGroup(); // Flush any workflow group first
          
          if (currentTaskRunId === taskRunId) {
            // Same task run, add to current group
            currentTaskGroup.push(event);
          } else {
            // Different task run, flush current group and start new one
            flushCurrentTaskGroup();
            currentTaskRunId = taskRunId;
            currentTaskGroup = [event];
          }
        } else if (scriptRunId) {
          // Has script_run_id but no task_run_id, group by script run (workflow)
          flushCurrentTaskGroup(); // Flush any task group first
          
          if (currentScriptRunId === scriptRunId) {
            // Same script run, add to current group
            currentWorkflowGroup.push(event);
          } else {
            // Different script run, flush current group and start new one
            flushCurrentWorkflowGroup();
            currentScriptRunId = scriptRunId;
            currentWorkflowGroup = [event];
          }
        }
        // Skip events without task_run_id or script_run_id
      }
    });

    // Flush any remaining groups
    flushCurrentTaskGroup();
    flushCurrentWorkflowGroup();

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
