// Database thread read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";
import { StorageThreadType } from "@app/db";

interface Thread {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  metadata: string;
}

export function useThreadMessages(threadId: string, userId?: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.threadMessages(threadId),
    queryFn: async () => {
      if (!api) return [];
      const messages = await api.memoryStore.getMessages({ threadId });
      // Return AssistantUIMessage directly without conversion
      return messages;
    },
    meta: { tables: ["messages"] },
    enabled: !!api && !!threadId,
  });
}

export function useAllThreads() {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allThreads(),
    queryFn: async () => {
      if (!api) return [];
      const threads = await api.memoryStore.listThreads();
      
      // Convert StorageThreadType[] to Thread[] format
      return threads.map((thread: StorageThreadType): Thread => ({
        id: thread.id,
        title: thread.title || '',
        user_id: thread.user_id,
        created_at: thread.created_at.toISOString(),
        updated_at: thread.updated_at.toISOString(),
        metadata: JSON.stringify(thread.metadata || {}),
      }));
    },
    meta: { tables: ["threads"] },
    enabled: !!api,
  });
}

export function useThread(threadId: string, userId?: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.thread(threadId),
    queryFn: async () => {
      if (!api) return null;
      const thread = await api.memoryStore.getThread(threadId);
      if (!thread) return null;
      
      // Convert StorageThreadType to the expected Thread format
      return {
        id: thread.id,
        title: thread.title || '',
        user_id: thread.user_id,
        created_at: thread.created_at.toISOString(),
        updated_at: thread.updated_at.toISOString(),
        metadata: JSON.stringify(thread.metadata || {}),
      };
    },
    meta: { tables: ["threads"] },
    enabled: !!api && !!threadId,
  });
}