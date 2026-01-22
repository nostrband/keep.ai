// Hook for querying unresolved notifications (for notification bell badge)
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { Notification } from "packages/db/dist";

export interface UnresolvedNotificationsResult {
  count: number;
  notifications: Notification[];
}

/**
 * Hook to get unresolved notifications for the notification bell.
 * Returns count and list of unresolved notifications.
 */
export function useUnresolvedNotifications() {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: qk.unresolvedNotifications(),
    queryFn: async (): Promise<UnresolvedNotificationsResult> => {
      if (!api) return { count: 0, notifications: [] };
      const result = await api.notificationStore.getUnresolvedNotifications(10);
      return result;
    },
    meta: { tables: ["notifications"] },
    enabled: !!api,
  });
}
