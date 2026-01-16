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

export function useWorkflows() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.allWorkflows(),
    queryFn: async () => {
      if (!api) return [];
      const workflows = await api.scriptStore.listWorkflows();
      return workflows;
    },
    meta: { tables: ["workflows"] },
    enabled: !!api,
  });
}

export function useWorkflow(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflow(workflowId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const workflow = await api.scriptStore.getWorkflow(workflowId);
        return workflow;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["workflows"] },
    enabled: !!api && !!workflowId,
  });
}

export function useWorkflowByTaskId(taskId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowByTaskId(taskId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const workflow = await api.scriptStore.getWorkflowByTaskId(taskId);
        return workflow;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["workflows"] },
    enabled: !!api && !!taskId,
  });
}

export function useLatestScriptByWorkflowId(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.latestWorkflowScript(workflowId),
    queryFn: async () => {
      if (!api) return null;
      try {
        const script = await api.scriptStore.getLatestScriptByWorkflowId(workflowId);
        return script;
      } catch (error) {
        return null;
      }
    },
    meta: { tables: ["scripts"] },
    enabled: !!api && !!workflowId,
  });
}

export function useScriptRunsByWorkflowId(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowScriptRuns(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const runs = await api.scriptStore.getScriptRunsByWorkflowId(workflowId);
        return runs;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["script_runs"] },
    enabled: !!api && !!workflowId,
  });
}

export function useScriptVersionsByWorkflowId(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowScripts(workflowId),
    queryFn: async () => {
      if (!api) return [];
      try {
        const scripts = await api.scriptStore.getScriptsByWorkflowId(workflowId);
        return scripts;
      } catch (error) {
        return [];
      }
    },
    meta: { tables: ["scripts"] },
    enabled: !!api && !!workflowId,
  });
}
