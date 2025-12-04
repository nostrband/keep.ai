// Database chat read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useChatMessages(chatId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.chatMessages(chatId),
    queryFn: async () => {
      if (!api) return [];
      // Use the new getChatMessages method from chatStore to read from chat_events table
      const messages = await api.chatStore.getChatMessages({ chatId });
      // Return AssistantUIMessage directly without conversion
      return messages;
    },
    meta: { tables: ["chat_events"] },
    enabled: !!api && !!chatId,
  });
}

export function useChatEvents(chatId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.chatEvents(chatId),
    queryFn: async () => {
      if (!api) return [];
      // Get all chat events (messages + agent events) in chronological order
      const events = await api.chatStore.getChatEvents({ chatId });
      return events;
    },
    meta: { tables: ["chat_events"] },
    enabled: !!api && !!chatId,
  });
}

export function useAllChats() {
  const { api } = useDbQuery();
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
  const { api } = useDbQuery();
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