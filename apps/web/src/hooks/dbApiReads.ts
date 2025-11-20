// Database API read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useAgentStatus() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.agentStatus(),
    queryFn: async () => {
      if (!api) return '';
      return await api.getAgentStatus();
    },
    meta: { tables: ["agent_state"] },
    enabled: !!api,
    refetchInterval: 5000, // Refresh every 5 seconds to keep status current
  });
}