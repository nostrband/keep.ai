// Database write hooks using TanStack Query mutations
import { InfiniteData, useMutation } from "@tanstack/react-query";
import { notifyTablesChanged, queryClient } from "../queryClient";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { File } from "@app/db";
import type { Mutation } from "@app/db";

export function useCreateTask() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      content: string;
      files?: File[];
      title?: string;
    }) => {
      if (!api) throw new Error("Database not available");

      return await api.createTask({
        content: input.content,
        files: input.files,
        title: input.title,
      });
    },
    onSuccess: () => {
      notifyTablesChanged(
        ["chats", "chat_messages", "tasks", "workflows", "inbox"],
        true,
        api!
      );
    },
  });
}

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
      next_run_timestamp?: string;
    }) => {
      if (!api) throw new Error("Script store not available");

      const fields: Parameters<typeof api.scriptStore.updateWorkflowFields>[1] = {};
      if (input.status !== undefined) fields.status = input.status;
      if (input.title !== undefined) fields.title = input.title;
      if (input.cron !== undefined) fields.cron = input.cron;
      if (input.next_run_timestamp !== undefined) fields.next_run_timestamp = input.next_run_timestamp;

      await api.scriptStore.updateWorkflowFields(input.workflowId, fields);
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
 *
 * Uses api.activateScript with manual=true to atomically:
 * - Set active_script_id to the target script
 * - Clear maintenance flag
 * - Reset maintenance_fix_count (manual activation = fresh start)
 * - Reset all producer schedules to run immediately
 *
 * The script is validated before activation to ensure it belongs to the workflow.
 */
export function useActivateScriptVersion() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      scriptId: string;  // The script version to activate
      /** When provided, set workflow status atomically (e.g. 'active') */
      status?: string;
    }) => {
      if (!api) throw new Error("Script store not available");

      // Validate the script exists and belongs to this workflow
      const script = await api.scriptStore.getScript(input.scriptId);
      if (!script) throw new Error("Script not found");
      if (script.workflow_id !== input.workflowId) {
        throw new Error("Script does not belong to this workflow");
      }

      // Use the unified activateScript function (manual=true for UI activation)
      await api.activateScript({
        workflowId: input.workflowId,
        scriptId: input.scriptId,
        manual: true,
        status: input.status,
      });

      return { scriptId: input.scriptId, version: `${script.major_version}.${script.minor_version}` };
    },
    onSuccess: (_result, { workflowId }) => {
      // Invalidate workflow queries since active_script_id changed
      queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.allWorkflows() });
      // Also invalidate script queries for UI consistency
      queryClient.invalidateQueries({ queryKey: qk.workflowScripts(workflowId) });
      queryClient.invalidateQueries({ queryKey: qk.latestWorkflowScript(workflowId) });

      notifyTablesChanged(["workflows", "producer_schedules"], true, api!);
    },
  });
}

/**
 * @deprecated Use useActivateScriptVersion instead.
 * This alias is provided for backward compatibility during transition.
 */
export const useRollbackScript = useActivateScriptVersion;

/**
 * Update the label for a connection.
 * Labels are user-defined names like "Work Gmail" or "Personal Drive".
 */
export function useUpdateConnectionLabel() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: { connectionId: string; label: string }) => {
      if (!api) throw new Error("Connection store not available");

      await api.connectionStore.updateLabel(input.connectionId, input.label);
      return input;
    },
    onSuccess: (_result, { connectionId }) => {
      // Invalidate connection queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.connection(connectionId) });
      queryClient.invalidateQueries({ queryKey: qk.allConnections() });

      notifyTablesChanged(["connections"], true, api!);
    },
  });
}

/**
 * Disconnect (remove) a connection.
 * Calls the server API to delete credentials and database record.
 */
export function useDisconnectConnection(apiEndpoint: string) {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      const [service, accountId] = connectionId.split(":");

      const response = await fetch(
        `${apiEndpoint}/connectors/${service}/${encodeURIComponent(accountId)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to disconnect");
      }

      return connectionId;
    },
    onSuccess: () => {
      // Invalidate connection queries to get fresh data
      queryClient.invalidateQueries({ queryKey: qk.allConnections() });

      if (api) {
        notifyTablesChanged(["connections"], true, api);
      }
    },
  });
}

/**
 * Resolve an indeterminate mutation.
 *
 * Two actions:
 * - "did_not_happen": Mark mutation failed, release events, clear pending_retry
 * - "skip": Mark mutation failed (skipped), skip events, commit run, clear pending_retry
 *
 * Neither action auto-resumes the workflow — user must manually resume.
 */
export function useResolveMutation() {
  const { api } = useDbQuery();

  return useMutation({
    mutationFn: async (input: {
      mutation: Mutation;
      action: "did_not_happen" | "skip";
    }) => {
      if (!api) throw new Error("Database not available");

      const { mutation, action } = input;
      const run = await api.handlerRunStore.get(mutation.handler_run_id);
      if (!run) throw new Error("Handler run not found");

      const now = Date.now();
      const endTimestamp = new Date().toISOString();

      await api.db.db.tx(async (tx: any) => {
        if (action === "did_not_happen") {
          // User confirms mutation did not complete
          await api.mutationStore.update(mutation.id, {
            status: "failed",
            resolved_by: "user_assert_failed",
            resolved_at: now,
          }, tx);
          await api.handlerRunStore.update(run.id, {
            status: "failed:logic" as any,
            error: "User confirmed mutation did not complete",
            end_timestamp: endTimestamp,
          }, tx);
          // Release reserved events — mutation didn't happen, events can be reprocessed
          await api.eventStore.releaseEvents(run.id, tx);
          // Clear pending retry — no retry needed for failed mutation
          await api.scriptStore.updateWorkflowFields(run.workflow_id, {
            pending_retry_run_id: '',
          }, tx);
        } else {
          // User wants to skip this event
          await api.mutationStore.update(mutation.id, {
            status: "failed",
            resolved_by: "user_skip",
            resolved_at: now,
          }, tx);
          // Skip events — mark as skipped (not reprocessed)
          await api.eventStore.skipEvents(run.id, tx);
          // Mark run as committed (event processed, even though mutation was skipped)
          await api.handlerRunStore.update(run.id, {
            phase: "committed" as any,
            status: "committed" as any,
            error: "",
            end_timestamp: endTimestamp,
          }, tx);
          await api.scriptStore.incrementHandlerCount(run.script_run_id, tx);
          // Clear pending retry
          await api.scriptStore.updateWorkflowFields(run.workflow_id, {
            pending_retry_run_id: '',
          }, tx);
        }
      });

      return { action, mutationId: mutation.id };
    },
    onSuccess: () => {
      notifyTablesChanged(
        ["mutations", "handler_runs", "workflows", "events"],
        true,
        api!
      );
    },
  });
}
