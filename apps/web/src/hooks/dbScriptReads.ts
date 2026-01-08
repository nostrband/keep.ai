// Database script read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useScripts() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.allScripts(),
    queryFn: async () => {
      if (!api) return [];
      const scripts = await api.scriptStore.listLatestScripts();
      return scripts;
    },
    meta: { tables: ["scripts"] },
    enabled: !!api,
  });
}

export function useScript(scriptId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.script(scriptId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const script = await api.scriptStore.getScript(scriptId);
        return script;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["scripts"] },
    enabled: !!api && !!scriptId,
  });
}

export function useScriptVersions(taskId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.scriptVersions(taskId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const scripts = await api.scriptStore.getScriptsByTaskId(taskId);
        return scripts;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["scripts"] },
    enabled: !!api && !!taskId,
  });
}

export function useLatestScriptByTaskId(taskId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.latestScript(taskId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const script = await api.scriptStore.getLatestScriptByTaskId(taskId);
        return script;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["scripts"] },
    enabled: !!api && !!taskId,
  });
}

export function useScriptRuns(scriptId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.scriptRuns(scriptId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const runs = await api.scriptStore.getScriptRunsByScriptId(scriptId);
        return runs;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["script_runs"] },
    enabled: !!api && !!scriptId,
  });
}

export function useScriptRun(runId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.scriptRun(runId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const run = await api.scriptStore.getScriptRun(runId);
        return run;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["script_runs"] },
    enabled: !!api && !!runId,
  });
}
