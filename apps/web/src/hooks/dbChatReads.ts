// Database chat read hooks using TanStack Query
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
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
  return useInfiniteQuery({
    queryKey: qk.chatEvents(chatId),
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      if (!api) return { events: [], nextCursor: undefined };
      
      // Get chat events with pagination
      // pageParam is the timestamp to get events before (older events)
      const events = await api.chatStore.getChatEvents({
        chatId,
        limit: 50,
        before: pageParam
      });
      
      // The nextCursor is the timestamp of the oldest event in this page
      // Since events come in DESC order, the oldest is the last one
      const nextCursor = events.length === 50 && events.length > 0
        ? events[events.length - 1].timestamp
        : undefined;
      
      return { events, nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined,
    meta: { tables: ["chat_events"] },
    enabled: !!api && !!chatId,
    select: (data) => {
      // Flatten all pages but maintain DESC order (newest first)
      // Each page is already in DESC order from the database
      const allEvents = data.pages.flatMap(page => page.events);
      return {
        pages: data.pages,
        pageParams: data.pageParams,
        events: allEvents,
      };
    },
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