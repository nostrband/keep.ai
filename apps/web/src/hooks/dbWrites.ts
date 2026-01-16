// Database write hooks using TanStack Query mutations
import { InfiniteData, useMutation } from "@tanstack/react-query";
import { notifyTablesChanged, queryClient } from "../queryClient";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { ChatEvent } from "@app/proto";
import { UseChatEventsResult } from "./dbChatReads";
import { File } from "@app/db";

export function useAddMessage() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      chatId: string;
      role: "user" | "assistant";
      content: string;
      files?: File[];
    }) => {
      if (!api) throw new Error("Memory store not available");

      const message = await api.addMessage({
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        files: input.files,
      });

      return message;
    },
    onSuccess: () => {
      notifyTablesChanged(
        ["messages", "threads", "chats", "chat_events"],
        true,
        api!
      );
    },
  });
}

export function useReadChat() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { chatId: string }) => {
      if (!api) throw new Error("Chat store not available");

      const chat = await api.chatStore.getChat(input.chatId);
      const events = await api.chatStore.getChatEvents({
        chatId: input.chatId,
        limit: 1,
      });

      // Only update if last read timestamp was less than latest event's timestamp
      if (events.length && events[0].timestamp > (chat?.read_at || "")) {
        // Pass event timestamp to handle future timestamp edge case
        await api.chatStore.readChat(input.chatId, events[0].timestamp);
        return true;
      } else {
        // No need to update
        return false;
      }
    },
    onSuccess: (updated) => {
      if (updated) notifyTablesChanged(["chats"], true, api!);
    },
  });
}

export function useUpdateTask() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { taskId: string; timestamp: number }) => {
      if (!api) throw new Error("Task store not available");

      // Get the current task first
      const task = await api.taskStore.getTask(input.taskId);

      // Update the task with new timestamp and reset state
      await api.taskStore.updateTask({
        ...task,
        timestamp: input.timestamp,
        state: ''
      });

      return task;
    },
    onSuccess: (_result, { taskId }) => {
      // Invalidate task-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.task(taskId) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(false) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(true) });

      notifyTablesChanged(["tasks"], true, api!);
    },
  });
}

export function usePauseTask() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { taskId: string }) => {
      if (!api) throw new Error("Task store not available");

      // Get the current task first
      const task = await api.taskStore.getTask(input.taskId);

      // Update the task to paused state
      await api.taskStore.updateTask({
        ...task,
        state: 'error',
        reply: '',
        error: 'Paused'
      });

      return task;
    },
    onSuccess: (_result, { taskId }) => {
      // Invalidate task-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.task(taskId) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(false) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(true) });

      notifyTablesChanged(["tasks"], true, api!);
    },
  });
}

export function useUpdateWorkflow() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      status?: string;
      title?: string;
      cron?: string;
      events?: string;
      next_run_timestamp?: string;
    }) => {
      if (!api) throw new Error("Script store not available");

      // Get the current workflow first
      const workflow = await api.scriptStore.getWorkflow(input.workflowId);
      if (!workflow) throw new Error("Workflow not found");

      // Update the workflow with new values
      await api.scriptStore.updateWorkflow({
        ...workflow,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.cron !== undefined && { cron: input.cron }),
        ...(input.events !== undefined && { events: input.events }),
        ...(input.next_run_timestamp !== undefined && { next_run_timestamp: input.next_run_timestamp }),
      });

      return workflow;
    },
    onSuccess: (_result, { workflowId }) => {
      // Invalidate workflow-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.allWorkflows() });

      notifyTablesChanged(["workflows"], true, api!);
    },
  });
}

export function useDeletePeer() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (peerPubkey: string | string[]) => {
      if (!api) throw new Error("Nostr peer store not available");

      const pubkeys = Array.isArray(peerPubkey) ? peerPubkey : [peerPubkey];

      // Delete all specified peers using bulk delete
      await api.nostrPeerStore.deletePeers(pubkeys);
    },
    onSuccess: () => {
      // Invalidate to get fresh data from DB
      queryClient.invalidateQueries({ queryKey: qk.allNostrPeers() });

      notifyTablesChanged(["nostr_peers"], true, api!);
    },
  });
}
