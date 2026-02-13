import { JSONSchema } from "../json-schema";
import { KeepDbApi } from "@app/db";
import { defineTool, Tool } from "./types";

export interface UserSendContext {
  workflowId?: string;
  workflowTitle?: string;
  scriptRunId?: string;
}

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    message: { type: "string", description: "The message text to send to the user" },
  },
  required: ["message"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Generated notification/message ID" },
    success: { type: "boolean", description: "Whether the message was sent successfully" },
  },
  required: ["id", "success"],
};

interface Input {
  message: string;
}

interface Output {
  id: string;
  success: boolean;
}

/**
 * Create the User.send tool.
 */
export function makeUserSendTool(api: KeepDbApi, context?: UserSendContext): Tool<Input, Output> {
  return defineTool({
    namespace: "User",
    name: "send",
    description: `Send a message to the user.
This is useful for scripts to send execution results to user.
The message will create a notification that appears in the user's notification list.`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const notificationId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // If we have workflow context, create a notification (Spec 01)
      if (context?.workflowId) {
        await api.notificationStore.saveNotification({
          id: notificationId,
          workflow_id: context.workflowId,
          type: 'script_message',
          payload: JSON.stringify({
            message: input.message,
            script_run_id: context.scriptRunId || '',
          }),
          timestamp: timestamp,
          acknowledged_at: '',
          resolved_at: '',
          workflow_title: context.workflowTitle || '',
        });
      } else {
        // Fallback for non-workflow context: save to chat_messages
        // This maintains backwards compatibility for planner tasks
        const messageContent = JSON.stringify({
          id: notificationId,
          role: "assistant",
          metadata: {
            createdAt: timestamp,
            threadId: "main",
          },
          parts: [
            {
              type: "text",
              text: input.message,
            },
          ],
        });

        await api.chatStore.saveChatMessage({
          id: notificationId,
          chat_id: "main",
          role: 'assistant',
          content: messageContent,
          timestamp: timestamp,
          task_run_id: '',
          script_id: '',
          failed_script_run_id: '',
        });
      }

      return {
        id: notificationId,
        success: true,
      };
    },
  }) as Tool<Input, Output>;
}
