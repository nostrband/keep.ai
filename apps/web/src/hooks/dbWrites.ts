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
      threadId: string;
      role: "user" | "assistant";
      content: string;
      files?: File[];
    }) => {
      if (!api) throw new Error("Memory store not available");

      const message = await api.addMessage({
        threadId: input.threadId,
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
        // FIXME in theory event might have timestamp in the future,
        // and without passing it to the read method and having it set 'now' as read_at,
        // we'll be updating it on every scroll until that future timestamp
        await api.chatStore.readChat(input.chatId);
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

      // Update the task with new timestamp
      await api.taskStore.updateTask({
        ...task,
        timestamp: input.timestamp,
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
