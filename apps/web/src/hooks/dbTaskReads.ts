// Database task read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";

export function useTasks(includeFinished: boolean = true) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allTasks(includeFinished),
    queryFn: async () => {
      if (!api) return [];
      const tasks = await api.taskStore.listTasks(includeFinished);
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

export function useTaskState(taskId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.taskState(taskId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const taskState = await api.taskStore.getState(taskId);
        return taskState;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["task_states"] },
    enabled: !!api && !!taskId,
  });
}

export function useTaskRuns(taskId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.taskRuns(taskId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const taskRuns = await api.taskStore.listTaskRuns(taskId);
        return taskRuns;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["task_runs"] },
    enabled: !!api && !!taskId,
  });
}

export function useTaskRun(runId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.taskRun(runId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const taskRun = await api.taskStore.getTaskRun(runId);
        return taskRun;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["task_runs"] },
    enabled: !!api && !!runId,
  });
}