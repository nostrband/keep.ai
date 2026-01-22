// Hook for fetching notifications with infinite scroll
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { Notification } from "packages/db/dist";

export interface NotificationsResult {
  notifications: Notification[];
  nextCursor?: string;
}

interface UseNotificationsOptions {
  workflowId?: string;
  unresolvedOnly?: boolean;
  limit?: number;
}

/**
 * Hook to fetch notifications with infinite scroll pagination.
 * Can be filtered by workflowId and unresolvedOnly.
 */
export function useNotifications(options?: UseNotificationsOptions) {
  const { api } = useDbQuery();
  const limit = options?.limit ?? 20;

  const queryFn = async ({
    pageParam,
  }: {
    pageParam?: string;
  }): Promise<NotificationsResult> => {
    if (!api) return { notifications: [], nextCursor: undefined };

    const notifications = await api.notificationStore.getNotifications({
      workflowId: options?.workflowId,
      unresolvedOnly: options?.unresolvedOnly,
      limit,
      before: pageParam,
    });

    // The nextCursor is the timestamp of the oldest notification in this page
    const nextCursor =
      notifications.length >= limit
        ? notifications[notifications.length - 1]?.timestamp
        : undefined;

    return { notifications, nextCursor };
  };

  return useInfiniteQuery({
    queryKey: qk.notifications(options?.workflowId),
    queryFn,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined,
    meta: { tables: ["notifications"] },
    enabled: !!api,
    select: (data) => {
      // Flatten all pages
      const allNotifications = data.pages.flatMap((page) => page.notifications);
      return {
        pages: data.pages,
        pageParams: data.pageParams,
        notifications: allNotifications,
      };
    },
  });
}

/**
 * Hook to acknowledge a notification (mark as seen).
 */
export function useAcknowledgeNotification() {
  const { api } = useDbQuery();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!api) throw new Error("API not available");
      await api.notificationStore.acknowledgeNotification(id);
    },
    onSuccess: () => {
      // Invalidate notifications queries
      queryClient.invalidateQueries({ queryKey: qk.notifications() });
      queryClient.invalidateQueries({ queryKey: qk.unresolvedNotifications() });
    },
  });
}

/**
 * Hook to resolve a notification (mark issue as addressed).
 */
export function useResolveNotification() {
  const { api } = useDbQuery();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!api) throw new Error("API not available");
      await api.notificationStore.resolveNotification(id);
    },
    onSuccess: () => {
      // Invalidate notifications queries
      queryClient.invalidateQueries({ queryKey: qk.notifications() });
      queryClient.invalidateQueries({ queryKey: qk.unresolvedNotifications() });
    },
  });
}
