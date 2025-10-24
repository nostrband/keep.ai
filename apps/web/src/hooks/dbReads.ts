// Database read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";
import { AssistantUIMessage } from "@app/proto";
import { StorageThreadType } from "@app/db";

interface Message {
  id: string;
  thread_id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string;
}

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
      // Convert AssistantUIMessage to the expected Message format
      return messages.map((msg: AssistantUIMessage): Message => ({
        id: msg.id,
        thread_id: msg.metadata?.threadId || threadId,
        user_id: msg.metadata?.userId || 'default-user',
        role: msg.role,
        content: msg.parts?.map(part => part.type === 'text' ? part.text : '').join('') || '',
        created_at: msg.metadata?.createdAt || new Date().toISOString(),
      }));
    },
    meta: { tables: ["messages"] },
    enabled: !!api && !!threadId,
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