// Database connection read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

/**
 * Hook to fetch all connections.
 * Auto-updates when connections table changes.
 */
export function useConnections() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.allConnections(),
    queryFn: async () => {
      if (!api) return [];
      return await api.connectionStore.listConnections();
    },
    meta: { tables: ["connections"] },
    enabled: !!api,
  });
}

/**
 * Hook to fetch a specific connection by ID.
 */
export function useConnection(connectionId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.connection(connectionId),
    queryFn: async () => {
      if (!api) return null;
      return await api.connectionStore.getConnection(connectionId);
    },
    meta: { tables: ["connections"] },
    enabled: !!api && !!connectionId,
  });
}

/**
 * Hook to fetch connections for a specific service.
 */
export function useConnectionsByService(service: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.connectionsByService(service),
    queryFn: async () => {
      if (!api) return [];
      return await api.connectionStore.listByService(service);
    },
    meta: { tables: ["connections"] },
    enabled: !!api && !!service,
  });
}
