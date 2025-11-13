// Database task read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";
import { Task } from "@app/db";

export function useTasks(includeFinished: boolean = true) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allTasks(includeFinished),
    queryFn: async () => {
      if (!api) return [];
      const tasks = await api.taskStore.listTasks(includeFinished, 'worker');
      return tasks;
    },
    meta: { tables: ["tasks"] },
    enabled: !!api,
  });
}

export function useTask(taskId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.task(taskId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const task = await api.taskStore.getTask(taskId);
        return task;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["tasks"] },
    enabled: !!api && !!taskId,
  });
}