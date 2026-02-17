import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

/**
 * Get all handler runs for a script run (session), ordered by start_timestamp ASC.
 */
export function useHandlerRunsBySession(scriptRunId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.handlerRunsBySession(scriptRunId),
    queryFn: async () => {
      if (!api) return [];
      try {
        return await api.handlerRunStore.getBySession(scriptRunId);
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["handler_runs"] },
    enabled: !!api && !!scriptRunId,
  });
}

/**
 * Get a single handler run by ID.
 */
export function useHandlerRun(handlerRunId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.handlerRun(handlerRunId),
    queryFn: async () => {
      if (!api) return null;
      try {
        return await api.handlerRunStore.get(handlerRunId);
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["handler_runs"] },
    enabled: !!api && !!handlerRunId,
  });
}

/**
 * Get the full retry chain for a handler run (oldest first).
 */
export function useHandlerRunRetryChain(handlerRunId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.handlerRunRetryChain(handlerRunId),
    queryFn: async () => {
      if (!api) return [];
      try {
        return await api.handlerRunStore.getRetryChain(handlerRunId);
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["handler_runs"] },
    enabled: !!api && !!handlerRunId,
  });
}

/**
 * Get the mutation for a handler run (1:1 relationship).
 */
export function useMutationByHandlerRunId(handlerRunId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.mutationByHandlerRun(handlerRunId),
    queryFn: async () => {
      if (!api) return null;
      try {
        return await api.mutationStore.getByHandlerRunId(handlerRunId);
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["mutations"] },
    enabled: !!api && !!handlerRunId,
  });
}

/**
 * Get all topics for a workflow, returning a map of topic ID → topic name.
 */
export function useWorkflowTopicMap(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowTopics(workflowId),
    queryFn: async () => {
      if (!api) return {};
      try {
        const topics = await api.topicStore.list(workflowId);
        const map: Record<string, string> = {};
        for (const t of topics) {
          map[t.id] = t.name;
        }
        return map;
      } catch (error) {
        return {};
      }
    },
    meta: { tables: ["topics"] },
    enabled: !!api && !!workflowId,
  });
}

/**
 * Get event counts (created/consumed) for all handler runs in a session.
 */
export function useEventCountsBySession(scriptRunId: string, handlerRunIds: string[]) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.eventCountsBySession(scriptRunId),
    queryFn: async () => {
      if (!api || handlerRunIds.length === 0) return {};
      try {
        return await api.eventStore.getCountsByHandlerRunIds(handlerRunIds);
      } catch (error) {
        return {};
      }
    },
    meta: { tables: ["events"] },
    enabled: !!api && !!scriptRunId && handlerRunIds.length > 0,
  });
}

/**
 * Get events associated with a handler run (created by and reserved by).
 */
export function useEventsByHandlerRun(handlerRunId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.eventsByHandlerRun(handlerRunId),
    queryFn: async () => {
      if (!api) return { created: [], reserved: [] };
      try {
        return await api.eventStore.getByHandlerRunId(handlerRunId);
      } catch (error) {
        return { created: [], reserved: [] };
      }
    },
    meta: { tables: ["events"] },
    enabled: !!api && !!handlerRunId,
  });
}
