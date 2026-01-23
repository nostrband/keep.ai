// Database write hooks using TanStack Query mutations
import { InfiniteData, useMutation } from "@tanstack/react-query";
import { notifyTablesChanged, queryClient } from "../queryClient";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { File } from "@app/db";

export function useAddMessage() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      chatId: string;
      role: "user" | "assistant";
      content: string;
      files?: File[];
    }) => {
      if (!api) throw new Error("Memory store not available");

      const message = await api.addMessage({
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        files: input.files,
      });

      return message;
    },
    onSuccess: () => {
      notifyTablesChanged(
        ["messages", "threads", "chats", "chat_messages"],
        true,
        api!
      );
    },
  });
}

export function useReadChat() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { chatId: string }) => {
      if (!api) throw new Error("Chat store not available");

      const chat = await api.chatStore.getChat(input.chatId);
      // Get last message timestamp from chat_messages table (Spec 12)
      const lastActivity = await api.chatStore.getLastMessageActivity(input.chatId);

      // Only update if last read timestamp was less than latest message timestamp
      if (lastActivity && lastActivity > (chat?.read_at || "")) {
        // Pass message timestamp to handle future timestamp edge case
        await api.chatStore.readChat(input.chatId, lastActivity);
        return true;
      } else {
        // No need to update
        return false;
      }
    },
    onSuccess: (updated) => {
      if (updated) notifyTablesChanged(["chats"], true, api!);
    },
  });
}

export function useUpdateTask() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { taskId: string; timestamp: number }) => {
      if (!api) throw new Error("Task store not available");

      // Get the current task first
      const task = await api.taskStore.getTask(input.taskId);

      // Update the task with new timestamp and reset state
      await api.taskStore.updateTask({
        ...task,
        timestamp: input.timestamp,
        state: ''
      });

      return task;
    },
    onSuccess: (_result, { taskId }) => {
      // Invalidate task-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.task(taskId) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(false) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(true) });

      notifyTablesChanged(["tasks"], true, api!);
    },
  });
}

export function usePauseTask() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { taskId: string }) => {
      if (!api) throw new Error("Task store not available");

      // Get the current task first
      const task = await api.taskStore.getTask(input.taskId);

      // Update the task to paused state
      await api.taskStore.updateTask({
        ...task,
        state: 'error',
        reply: '',
        error: 'Paused'
      });

      return task;
    },
    onSuccess: (_result, { taskId }) => {
      // Invalidate task-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.task(taskId) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(false) });
      queryClient.invalidateQueries({ queryKey: qk.allTasks(true) });

      notifyTablesChanged(["tasks"], true, api!);
    },
  });
}

export function useUpdateWorkflow() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      status?: string;
      title?: string;
      cron?: string;
      events?: string;
      next_run_timestamp?: string;
    }) => {
      if (!api) throw new Error("Script store not available");

      // Get the current workflow first
      const workflow = await api.scriptStore.getWorkflow(input.workflowId);
      if (!workflow) throw new Error("Workflow not found");

      // Update the workflow with new values
      await api.scriptStore.updateWorkflow({
        ...workflow,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.cron !== undefined && { cron: input.cron }),
        ...(input.events !== undefined && { events: input.events }),
        ...(input.next_run_timestamp !== undefined && { next_run_timestamp: input.next_run_timestamp }),
      });

      return workflow;
    },
    onSuccess: (_result, { workflowId }) => {
      // Invalidate workflow-related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.allWorkflows() });

      notifyTablesChanged(["workflows"], true, api!);
    },
  });
}

export function useDeletePeer() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (peerPubkey: string | string[]) => {
      if (!api) throw new Error("Nostr peer store not available");

      const pubkeys = Array.isArray(peerPubkey) ? peerPubkey : [peerPubkey];

      // Delete all specified peers using bulk delete
      await api.nostrPeerStore.deletePeers(pubkeys);
    },
    onSuccess: () => {
      // Invalidate to get fresh data from DB
      queryClient.invalidateQueries({ queryKey: qk.allNostrPeers() });

      notifyTablesChanged(["nostr_peers"], true, api!);
    },
  });
}

/**
 * Activate a specific script version for a workflow.
 * Instead of creating a new script version (rollback), this just updates
 * the workflow's active_script_id pointer to the target script.
 *
 * Benefits over the old "rollback" approach:
 * - No duplicate script content
 * - No version number inflation
 * - No race conditions on version computation
 * - Idempotent operation (double-click safe)
 * - Better performance (just a pointer update)
 */
export function useActivateScriptVersion() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      scriptId: string;  // The script version to activate
    }) => {
      if (!api) throw new Error("Script store not available");

      // Validate the script exists and belongs to this workflow
      const script = await api.scriptStore.getScript(input.scriptId);
      if (!script) throw new Error("Script not found");
      if (script.workflow_id !== input.workflowId) {
        throw new Error("Script does not belong to this workflow");
      }

      // Just update the pointer - no new script creation needed
      await api.scriptStore.updateWorkflowFields(input.workflowId, {
        active_script_id: input.scriptId,
      });

      return { scriptId: input.scriptId, version: script.version };
    },
    onSuccess: (_result, { workflowId }) => {
      // Invalidate workflow queries since active_script_id changed
      queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.allWorkflows() });
      // Also invalidate script queries for UI consistency
      queryClient.invalidateQueries({ queryKey: qk.workflowScripts(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.latestWorkflowScript(workflowId) });

      notifyTablesChanged(["workflows"], true, api!);
    },
  });
}

/**
 * @deprecated Use useActivateScriptVersion instead.
 * This alias is provided for backward compatibility during transition.
 */
export const useRollbackScript = useActivateScriptVersion;
