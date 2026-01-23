// Hook for fetching agent status from the server API
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";

interface AgentStatus {
  activeTaskRuns: number;
  activeScriptRuns: number;
  isRunning: boolean;
}

/**
 * Hook to fetch current agent activity status.
 * Polls the /api/agent/status endpoint every 5 seconds when any runs are active,
 * or every 30 seconds when idle.
 */
export function useAgentStatus() {
  return useQuery({
    queryKey: qk.agentStatus(),
    queryFn: async (): Promise<AgentStatus> => {
      const response = await fetch("/api/agent/status");
      if (!response.ok) {
        throw new Error(`Failed to fetch agent status: ${response.status}`);
      }
      return response.json();
    },
    // Poll more frequently when running, less frequently when idle
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.isRunning) {
        return 5000; // 5 seconds when active
      }
      return 30000; // 30 seconds when idle
    },
    // Keep previous data during refetch for smoother UI
    placeholderData: (previousData) => previousData,
    // Start with a reasonable default
    initialData: {
      activeTaskRuns: 0,
      activeScriptRuns: 0,
      isRunning: false,
    },
    // Refetch on window focus
    refetchOnWindowFocus: true,
    // Don't retry too aggressively
    retry: 1,
    // Consider data stale after 10 seconds
    staleTime: 10000,
    // Also track in tables for auto-invalidation when task_runs or script_runs change
    meta: { tables: ["task_runs", "script_runs"] },
  });
}

/**
 * Format agent status for display.
 * Returns a human-readable status string.
 */
export function formatAgentStatus(status: AgentStatus | undefined): string {
  if (!status || !status.isRunning) {
    return "Idle";
  }

  const parts: string[] = [];

  if (status.activeTaskRuns > 0) {
    parts.push(`${status.activeTaskRuns} task${status.activeTaskRuns > 1 ? "s" : ""}`);
  }

  if (status.activeScriptRuns > 0) {
    parts.push(`${status.activeScriptRuns} workflow${status.activeScriptRuns > 1 ? "s" : ""}`);
  }

  return parts.join(", ") + " running";
}
