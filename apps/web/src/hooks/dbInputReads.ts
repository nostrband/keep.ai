// Database input/output read hooks using TanStack Query (exec-16)
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

/**
 * Get inputs for a workflow with computed status.
 */
export function useWorkflowInputs(workflowId: string, options?: { limit?: number; offset?: number }) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowInputs(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const inputs = await api.inputStore.getByWorkflowWithStatus(workflowId, options);
        return inputs;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["inputs", "events"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Get aggregated input statistics by source/type for a workflow.
 */
export function useWorkflowInputStats(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowInputStats(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const stats = await api.inputStore.getStatsByWorkflow(workflowId);
        return stats;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["inputs", "events"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Get aggregated output statistics by connector for a workflow.
 */
export function useWorkflowOutputStats(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowOutputStats(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const stats = await api.mutationStore.getOutputStatsByWorkflow(workflowId);
        return stats;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["mutations"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Get stale inputs for a workflow (pending longer than threshold).
 */
export function useWorkflowStaleInputs(workflowId: string, thresholdMs: number = 7 * 24 * 60 * 60 * 1000) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowStaleInputs(workflowId, thresholdMs),
    queryFn: async () => {
      if (!api) return [];
      try {
        const inputs = await api.inputStore.getStaleInputs(workflowId, thresholdMs);
        return inputs;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["inputs", "events"] },
    enabled: !!api && !!workflowId,
    // Refresh every 5 minutes for time-based queries
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Get count of inputs needing attention for a workflow.
 */
export function useWorkflowNeedsAttentionCount(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowNeedsAttention(workflowId),
    queryFn: async () => {
      if (!api) return 0;
      try {
        const count = await api.inputStore.countNeedsAttention(workflowId);
        return count;
      } catch (error) {
        return 0;
      }
    },
    meta: { tables: ["inputs", "events", "mutations", "handler_runs"] },
    enabled: !!api && !!workflowId,
    // Refresh every 5 minutes for time-based queries
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Get a single input by ID.
 */
export function useInput(inputId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.input(inputId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const input = await api.inputStore.get(inputId);
        return input;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["inputs"] },
    enabled: !!api && !!inputId,
  });
}

/**
 * Get mutations caused by an input.
 */
export function useInputMutations(inputId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.inputMutations(inputId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const mutations = await api.mutationStore.getByInputId(inputId);
        return mutations;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["mutations", "events"] },
    enabled: !!api && !!inputId,
  });
}

/**
 * Get events referencing an input.
 */
export function useInputEvents(inputId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.inputEvents(inputId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const events = await api.eventStore.getByInputId(inputId);
        return events;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["events"] },
    enabled: !!api && !!inputId,
  });
}

/**
 * Get all mutations for a workflow (for outputs view).
 */
export function useWorkflowMutations(workflowId: string, options?: { status?: string; limit?: number }) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowMutations(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const mutations = await api.mutationStore.getByWorkflow(workflowId, {
          status: options?.status as "pending" | "in_flight" | "applied" | "failed" | "needs_reconcile" | "indeterminate" | undefined,
          limit: options?.limit,
        });
        return mutations;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["mutations"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Get mutations needing reconciliation (indeterminate or needs_reconcile) for a workflow.
 * Used to show reconciliation status alerts in workflow detail and main page.
 */
export function usePendingReconciliation(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.pendingReconciliation(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const [indeterminate, needsReconcile] = await Promise.all([
          api.mutationStore.getByWorkflow(workflowId, { status: "indeterminate" }),
          api.mutationStore.getNeedsReconcile(workflowId),
        ]);
        return [...indeterminate, ...needsReconcile];
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["mutations"] },
    enabled: !!api && !!workflowId,
  });
}
