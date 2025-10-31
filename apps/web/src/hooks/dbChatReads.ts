// Database chat read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";

export function useChatMessages(chatId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.chatMessages(chatId),
    queryFn: async () => {
      if (!api) return [];
      // Since chatId === threadId, we can use the same getMessages method
      const messages = await api.memoryStore.getMessages({ threadId: chatId });
      // Return AssistantUIMessage directly without conversion
      return messages;
    },
    meta: { tables: ["messages"] },
    enabled: !!api && !!chatId,
  });
}

export function useAllChats() {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allChats(),
    queryFn: async () => {
      if (!api) return [];
      const chats = await api.chatStore.getAllChats();
      return chats;
    },
    meta: { tables: ["chats"] },
    enabled: !!api,
  });
}

export function useChat(chatId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.chat(chatId),
    queryFn: async () => {
      if (!api) return null;
      // Get chat info from chats table
      const chats = await api.chatStore.getAllChats();
      const chat = chats.find(c => c.id === chatId);
      return chat || null;
    },
    meta: { tables: ["chats"] },
    enabled: !!api && !!chatId,
  });
}