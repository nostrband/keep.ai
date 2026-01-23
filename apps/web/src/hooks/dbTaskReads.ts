// Database task read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useTasks(includeFinished: boolean = true) {
  const { api } = useDbQuery();
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
  const { api } = useDbQuery();
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

export function useTaskRuns(taskId: string) {
  const { api } = useDbQuery();
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
  const { api } = useDbQuery();
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

export function useTaskByChatId(chatId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.taskByChatId(chatId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const task = await api.taskStore.getTaskByChatId(chatId);
        return task;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["tasks"] },
    enabled: !!api && !!chatId,
  });
}