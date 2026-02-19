// Hook for fetching notifications with infinite scroll
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { notifyTablesChanged } from "../queryClient";
import { Notification } from "packages/db/dist";
import { useConnections } from "./dbConnectionReads";
import { ExecutionModelClient } from "@app/browser";

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
      // Invalidate all notification-related queries
      queryClient.invalidateQueries({ queryKey: [{ scope: "notifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedWorkflowNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "notification" }] });
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
      // Invalidate all notification-related queries
      queryClient.invalidateQueries({ queryKey: [{ scope: "notifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedWorkflowNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "notification" }] });
    },
  });
}

/**
 * Hook to get the latest unresolved error for a specific workflow.
 * Used for showing error alerts on the workflow hub page.
 */
export function useUnresolvedWorkflowError(workflowId: string) {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: qk.notification(workflowId),
    queryFn: async (): Promise<Notification | null> => {
      if (!api || !workflowId) return null;
      return await api.notificationStore.getUnresolvedError(workflowId);
    },
    meta: { tables: ["notifications"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Hook to get ALL unresolved notifications for a specific workflow.
 * Used for showing notification banners on the workflow detail page.
 */
export function useUnresolvedWorkflowNotifications(workflowId: string) {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: qk.unresolvedWorkflowNotifications(workflowId),
    queryFn: async (): Promise<Notification[]> => {
      if (!api || !workflowId) return [];
      return await api.notificationStore.getUnresolvedWorkflowNotifications(workflowId);
    },
    meta: { tables: ["notifications"] },
    enabled: !!api && !!workflowId,
  });
}

export interface ResumableWorkflow {
  workflowId: string;
  title: string;
  notificationId: string;
  service: string;
}

/**
 * Hook to find workflows that can be resumed after a service reconnection.
 * Cross-references unresolved auth error notifications with connected services.
 */
export function useResumableWorkflows(service?: string) {
  const { api } = useDbQuery();
  const { data: connections = [] } = useConnections();

  return useQuery({
    queryKey: [{ scope: "resumableWorkflows", service }],
    queryFn: async (): Promise<ResumableWorkflow[]> => {
      if (!api) return [];

      const notifications = await api.notificationStore.getNotifications({
        unresolvedOnly: true,
      });

      // Filter to auth errors
      const authErrors = notifications.filter((n) => {
        if (n.type !== "error") return false;
        try {
          const payload = JSON.parse(n.payload);
          return payload.error_type === "auth";
        } catch {
          return false;
        }
      });

      // Build set of connected service:account pairs
      const connectedInstances = new Set(
        connections
          .filter((c) => c.status === "connected")
          .map((c) => `${c.service}:${c.accountId}`)
      );
      const connectedServices = new Set(
        connections.filter((c) => c.status === "connected").map((c) => c.service)
      );

      // Keep only those where the specific connector instance is now connected
      const resumable: ResumableWorkflow[] = [];
      for (const n of authErrors) {
        let rawSvc: string;
        let rawAccount: string;
        try {
          const p = JSON.parse(n.payload);
          rawSvc = p.service || "";
          rawAccount = p.account || "";
        } catch {
          continue;
        }
        if (!rawSvc) continue;
        // If account is specified, check the specific instance; otherwise just the service
        const isConnected = rawAccount
          ? connectedInstances.has(`${rawSvc}:${rawAccount}`)
          : connectedServices.has(rawSvc);
        if (!isConnected) continue;
        if (service && rawSvc !== service) continue;
        resumable.push({
          workflowId: n.workflow_id,
          title: n.workflow_title || n.workflow_id,
          notificationId: n.id,
          service: rawSvc,
        });
      }

      return resumable;
    },
    meta: { tables: ["notifications", "connections"] },
    enabled: !!api,
  });
}

/**
 * Batch mutation to resume workflows and resolve their auth notifications.
 * Uses EMC.resumeWorkflow which also clears workflow.error.
 */
export function useResumeWorkflows() {
  const { api } = useDbQuery();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workflows: ResumableWorkflow[]) => {
      if (!api) throw new Error("API not available");

      const emc = new ExecutionModelClient(api);
      for (const w of workflows) {
        await emc.resumeWorkflow(w.workflowId);
        await api.notificationStore.resolveNotification(w.notificationId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ scope: "notifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "unresolvedWorkflowNotifications" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "notification" }] });
      queryClient.invalidateQueries({ queryKey: [{ scope: "resumableWorkflows" }] });
      queryClient.invalidateQueries({ queryKey: qk.allWorkflows() });

      notifyTablesChanged(["notifications", "workflows"], true, api!);
    },
  });
}
