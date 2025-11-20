// Database write hooks using TanStack Query mutations
import { useMutation } from "@tanstack/react-query";
import { notifyTablesChanged, queryClient } from "../queryClient";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";

export function useAddMessage() {
  const { api } = useCRSqliteQuery();

  return useMutation({
    mutationFn: async (input: {
      threadId: string;
      role: "user" | "assistant";
      content: string;
    }) => {
      if (!api) throw new Error("Memory store not available");

      const message = await api.addMessage({
        threadId: input.threadId,
        role: input.role,
        content: input.content,
      });

      return message;
    },
    // onMutate: async ({ threadId, role, content, userId = 'default-user' }) => {
    //   await queryClient.cancelQueries({ queryKey: qk.threadMessages(threadId) });

    //   const messagesKey = qk.threadMessages(threadId);
    //   const prevMessages = queryClient.getQueryData<any[]>(messagesKey) ?? [];

    //   const optimistic = {
    //     id: `opt_${Date.now()}`,
    //     thread_id: threadId,
    //     role,
    //     content,
    //     created_at: new Date().toISOString()
    //   };

    //   queryClient.setQueryData(messagesKey, [...prevMessages, optimistic]);

    //   return { messagesKey, prevMessages };
    // },
    // onError: (_err, _vars, ctx) => {
    //   if (ctx) {
    //     queryClient.setQueryData(ctx.messagesKey, ctx.prevMessages);
    //   }
    // },
    onSuccess: (_result, { threadId }) => {
      // Invalidate to get fresh data from DB
      queryClient.invalidateQueries({ queryKey: qk.threadMessages(threadId) });
      queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });
      // Also invalidate chat-related queries since chatId === threadId
      queryClient.invalidateQueries({ queryKey: qk.chatMessages(threadId) });
      queryClient.invalidateQueries({ queryKey: qk.chat(threadId) });
      queryClient.invalidateQueries({ queryKey: qk.allChats() });

      notifyTablesChanged(["messages", "threads", "chats"], true, api!);
    },
  });
}

export function useReadChat() {
  const { api } = useCRSqliteQuery();

  return useMutation({
    mutationFn: async (input: {
      chatId: string;
    }) => {
      if (!api) throw new Error("Chat store not available");

      await api.chatStore.readChat(input.chatId);
    },
    onSuccess: (_result, { chatId }) => {
      // Invalidate chat-related queries to reflect the updated read_at timestamp
      queryClient.invalidateQueries({ queryKey: qk.chat(chatId) });
      queryClient.invalidateQueries({ queryKey: qk.allChats() });

      notifyTablesChanged(["chats"], true, api!);
    },
  });
}

export function useUpdateTask() {
  const { api } = useCRSqliteQuery();

  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      timestamp: number;
    }) => {
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
  const { api } = useCRSqliteQuery();

  return useMutation({
    mutationFn: async (peerPubkey: string) => {
      if (!api) throw new Error("Nostr peer store not available");

      await api.nostrPeerStore.deletePeer(peerPubkey);
    },
    onSuccess: () => {
      // Invalidate to get fresh data from DB
      queryClient.invalidateQueries({ queryKey: qk.allNostrPeers() });

      notifyTablesChanged(["nostr_peers"], true, api!);
    },
  });
}
