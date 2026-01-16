// Database chat read hooks using TanStack Query
import {
  useQuery,
  useInfiniteQuery,
  InfiniteData,
} from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { ChatEvent } from "packages/proto/dist";
import { queryClient } from "../queryClient";

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

export interface UseChatEventsResult {
  events: ChatEvent[];
  nextCursor?: string;
}

async function ensureEvents(newEvents: ChatEvent[], chatId: string) {
  const queryKey = qk.chatEvents(chatId);
  await queryClient.cancelQueries({
    queryKey,
  });

  // Ensure events are in the first page
  queryClient.setQueryData<InfiniteData<UseChatEventsResult>>(
    queryKey,
    (old) => {
      if (!old) return old;

      // console.log("old pages", old.pages);
      const pages = [...old.pages];
      const lastIndex = 0; // First page is where we'll append the events
      const lastPage = pages[lastIndex];
      const events = [...lastPage.events];

      // Add events that aren't already on the page
      for (const e of newEvents) {
        if (!events.find((oe) => oe.id === e.id)) events.push(e);
      }

      // Reorder by time DESC
      events.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      // Set updated page
      pages[lastIndex] = {
        ...lastPage,
        events,
      };

      // console.log("new pages", pages);

      // Return updated object
      return { ...old, pages };
    }
  );
}

export function useChatEvents(chatId: string) {
  const { api } = useDbQuery();

  const queryFn = async ({
    pageParam,
  }: {
    pageParam?: string;
  }): Promise<UseChatEventsResult> => {
    if (!api) return { events: [], nextCursor: undefined };

    // Get chat events with pagination
    // pageParam is the timestamp to get events before (older events)
    const events = await api.chatStore.getChatEvents({
      chatId,
      limit: 50,
      before: pageParam,
    });

    // The nextCursor is the timestamp of the oldest event in this page
    // Since events come in DESC order, the oldest is the last one
    const nextCursor =
      events.length > 0 ? events[events.length - 1].timestamp : undefined;

    return { events, nextCursor };
  };

  const queryKey = qk.chatEvents(chatId);
  return useInfiniteQuery({
    queryKey,
    queryFn,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined,
    meta: {
      tables: ["chat_events"],
      onTablesUpdate: async () => {
        const oldData = queryClient.getQueryData<InfiniteData<UseChatEventsResult>>(queryKey);
        if (oldData && oldData.pages.length && oldData.pages[0].events.length) {
          const oldFirstPage = oldData.pages[0];
          const firstPage = await queryFn({});
          if (firstPage.events.length) {
            // If event ranges intersect, assume we can do optimistic update
            if (firstPage.events.at(-1)!.timestamp < oldFirstPage.events[0].timestamp) {
              await ensureEvents(firstPage.events, chatId);
              return;
            }
          }
        }
        
        // Otherwise, just invalidate the query
        queryClient.invalidateQueries({ queryKey });
      },
    },
    enabled: !!api && !!chatId,
    select: (data) => {
      // Flatten all pages but maintain DESC order (newest first)
      // Each page is already in DESC order from the database
      const allEvents = data.pages.flatMap((page) => page.events);
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
      const chat = chats.find((c) => c.id === chatId);
      return chat || null;
    },
    meta: { tables: ["chats"] },
    enabled: !!api && !!chatId,
  });
}
