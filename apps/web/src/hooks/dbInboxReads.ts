// Database inbox read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import type { InboxItemSource, InboxItemTarget } from "@app/db";
import { useDbQuery } from "./dbQuery";

export function useInboxItems(options?: {
  source?: InboxItemSource;
  target?: InboxItemTarget;
  handled?: boolean;
  limit?: number;
  offset?: number;
}) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.inboxItems(options),
    queryFn: async () => {
      if (!api) return [];
      const items = await api.inboxStore.listInboxItems(options);
      return items;
    },
    meta: { tables: ["inbox"] },
    enabled: !!api,
  });
}

export function useInboxItem(id: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.inboxItem(id),
    queryFn: async () => {
      if (!api) return null;
      try {
        const item = await api.inboxStore.getInboxItem(id);
        return item;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["inbox"] },
    enabled: !!api && !!id,
  });
}

// Hook to get inbox item for a specific task run
export function useTaskRunInboxItem(taskRun: { inbox?: string } | null) {
  const { api } = useDbQuery();
  const inboxId = taskRun?.inbox;
  
  return useQuery({
    queryKey: qk.inboxItem(inboxId || ""),
    queryFn: async () => {
      if (!api || !inboxId) return null;
      try {
        const item = await api.inboxStore.getInboxItem(inboxId);
        return item;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["inbox"] },
    enabled: !!api && !!inboxId,
  });
}