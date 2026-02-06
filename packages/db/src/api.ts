import { AssistantUIMessage, AutonomyMode } from "@app/proto";
import { ChatStore } from "./chat-store";
import { ConnectionStore } from "./connection-store";
import { KeepDb } from "./database";
import { MemoryStore, Thread } from "./memory-store";
import { NoteStore } from "./note-store";
import { Task, TaskStore, TaskType, EnterMaintenanceModeParams, EnterMaintenanceModeResult } from "./task-store";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { NostrPeerStore } from "./nostr-peer-store";
import { InboxItem, InboxStore } from "./inbox-store";
import { File, FileStore } from "./file-store";
import { ScriptStore, Workflow } from "./script-store";
import { NotificationStore } from "./notification-store";
import { ExecutionLogStore } from "./execution-log-store";
import { ItemStore } from "./item-store";
import { TopicStore } from "./topic-store";
import { EventStore } from "./event-store";
import { HandlerRunStore } from "./handler-run-store";
import { MutationStore } from "./mutation-store";
import { HandlerStateStore } from "./handler-state-store";
import { ProducerScheduleStore } from "./producer-schedule-store";

export class KeepDbApi {
  public readonly db: KeepDb;
  public readonly memoryStore: MemoryStore;
  public readonly chatStore: ChatStore;
  public readonly connectionStore: ConnectionStore;
  public readonly noteStore: NoteStore;
  public readonly taskStore: TaskStore;
  public readonly nostrPeerStore: NostrPeerStore;
  public readonly inboxStore: InboxStore;
  public readonly fileStore: FileStore;
  public readonly scriptStore: ScriptStore;
  public readonly notificationStore: NotificationStore;
  public readonly executionLogStore: ExecutionLogStore;
  public readonly itemStore: ItemStore;
  public readonly topicStore: TopicStore;
  public readonly eventStore: EventStore;
  public readonly handlerRunStore: HandlerRunStore;
  public readonly mutationStore: MutationStore;
  public readonly handlerStateStore: HandlerStateStore;
  public readonly producerScheduleStore: ProducerScheduleStore;

  constructor(db: KeepDb) {
    this.db = db;
    this.memoryStore = new MemoryStore(db);
    this.chatStore = new ChatStore(db);
    this.connectionStore = new ConnectionStore(db);
    this.noteStore = new NoteStore(db);
    this.taskStore = new TaskStore(db);
    this.nostrPeerStore = new NostrPeerStore(db);
    this.inboxStore = new InboxStore(db);
    this.fileStore = new FileStore(db);
    this.scriptStore = new ScriptStore(db);
    this.notificationStore = new NotificationStore(db);
    this.executionLogStore = new ExecutionLogStore(db);
    this.itemStore = new ItemStore(db);
    this.topicStore = new TopicStore(db);
    this.eventStore = new EventStore(db);
    this.handlerRunStore = new HandlerRunStore(db);
    this.mutationStore = new MutationStore(db);
    this.handlerStateStore = new HandlerStateStore(db);
    this.producerScheduleStore = new ProducerScheduleStore(db);
  }

  async addMessage(input: {
    chatId: string;
    content: string;
    role?: "user" | "assistant"; // default = user
    files?: File[]; // array of file paths
  }): Promise<AssistantUIMessage> {
    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const role = input.role || "user";
      const chatId = input.chatId;

      // Get taskId by chatId
      const task = await this.taskStore.getTaskByChatId(chatId, tx);
      const taskId = task?.id || "";

      // Create the message in AssistantUIMessage format
      const parts: AssistantUIMessage["parts"] = [
        { type: "text", text: input.content },
      ];

      // Add file parts if files are provided
      if (input.files && input.files.length > 0) {
        for (const file of input.files) {
          parts.push({
            type: "file",
            url: file.path,
            mediaType: file.media_type,
            filename: file.name,
          });
        }
      }

      const message: AssistantUIMessage = {
        id: bytesToHex(randomBytes(16)),
        role,
        parts,
        metadata: {
          threadId: chatId,
          createdAt: now.toISOString(),
        },
      };

      // Save to chat_messages table (Spec 12)
      await this.chatStore.saveChatMessage({
        id: message.id,
        chat_id: chatId,
        role: role,
        content: JSON.stringify(message),
        timestamp: now.toISOString(),
        task_run_id: '',
        script_id: '',
        failed_script_run_id: '',
      }, tx);

      // Ensure Chat object exists with threadId reused as chatId
      const existingChat = await this.chatStore.getChat(chatId, tx);
      if (existingChat) {
        // Update existing chat
        await this.chatStore.updateChat({ chatId, updatedAt: now }, tx);
      } else {
        // Create new chat
        await this.chatStore.createChat({ chatId, message }, tx);
      }

      // Send to task inbox
      if (role === "user") {
        const inboxItem: InboxItem = {
          id: message.id,
          source: "user",
          source_id: message.id,
          target: chatId === "main" ? "worker" : "planner",
          target_id: taskId,
          timestamp: now.toISOString(),
          content: JSON.stringify(message),
          handler_thread_id: "",
          handler_timestamp: "",
        };
        await this.inboxStore.saveInbox(inboxItem, tx);
      }

      return message;
    });
  }

  /**
   * @deprecated This method uses global read_at which doesn't work properly across devices.
   * Per-device notification tracking via chat_notifications has been removed. See Spec 07.
   */
  async getNewAssistantMessages(): Promise<AssistantUIMessage[]> {
    const sql = `
      SELECT m.*
      FROM messages AS m
      JOIN chats AS c ON c.id = m.thread_id
      WHERE (c.read_at IS NULL OR m.created_at > c.read_at) AND m.role = 'assistant'
      ORDER BY m.created_at
    `;

    const result = await this.db.db.execO<Record<string, unknown>>(sql);
    if (!result) return [];

    return result
      .filter((row) => !!row.content)
      .map((row) => {
        // Parse the full UIMessage from content field
        try {
          return JSON.parse(row.content as string) as AssistantUIMessage;
        } catch (e) {
          console.debug("Bad message in db", row, e);
          return undefined;
        }
      })
      .filter((m) => !!m)
      .filter((m) => !!m.role);
  }

  /**
   * Set the user's autonomy preference.
   * @param mode - AutonomyMode ('ai_decides' or 'coordinate')
   */
  async setAutonomyMode(mode: AutonomyMode): Promise<void> {
    const timestamp = new Date().toISOString();
    const sql = `
      INSERT OR REPLACE INTO agent_state (key, value, timestamp)
      VALUES ('autonomy_mode', ?, ?)
    `;
    await this.db.db.exec(sql, [mode, timestamp]);
  }

  /**
   * Get the user's autonomy preference.
   * Defaults to 'ai_decides' if not set.
   */
  async getAutonomyMode(): Promise<AutonomyMode> {
    const sql = `
      SELECT value FROM agent_state WHERE key = 'autonomy_mode'
    `;
    const result = await this.db.db.execO<{ value: string }>(sql);

    if (!result || result.length === 0) {
      return 'ai_decides'; // Default mode
    }

    const value = result[0].value;
    if (value === 'coordinate') {
      return 'coordinate';
    }
    return 'ai_decides';
  }

  /**
   * Set the need_auth flag to indicate when LLM authentication is required.
   * When set, the task scheduler will pause processing until auth is resolved.
   * @param needed - Whether authentication is required
   * @param reason - Optional reason for why auth is needed (e.g., 'api_key_missing', 'auth_error')
   */
  async setNeedAuth(needed: boolean, reason?: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const value = JSON.stringify({ needed, reason, timestamp });
    const sql = `
      INSERT OR REPLACE INTO agent_state (key, value, timestamp)
      VALUES ('need_auth', ?, ?)
    `;
    await this.db.db.exec(sql, [value, timestamp]);
  }

  /**
   * Get the current need_auth state.
   * @returns Object with needed flag, optional reason, and timestamp
   */
  async getNeedAuth(): Promise<{ needed: boolean; reason?: string; timestamp?: string }> {
    const sql = `
      SELECT value FROM agent_state WHERE key = 'need_auth'
    `;
    const result = await this.db.db.execO<{ value: string }>(sql);

    if (!result || result.length === 0) {
      return { needed: false };
    }

    try {
      const parsed = JSON.parse(result[0].value);
      return {
        needed: parsed.needed === true,
        reason: parsed.reason,
        timestamp: parsed.timestamp,
      };
    } catch {
      return { needed: false };
    }
  }

  async createTask(input: {
    content: string;
    files?: File[];
    title?: string;
  }): Promise<{ chatId: string; taskId: string }> {
    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const timestamp = Math.floor(now.getTime() / 1000); // Convert to seconds

      // Generate ids
      const taskId = bytesToHex(randomBytes(16));
      const workflowId = bytesToHex(randomBytes(16));
      const chatId = bytesToHex(randomBytes(16));

      // Create the message in AssistantUIMessage format
      const parts: AssistantUIMessage["parts"] = [
        { type: "text", text: input.content },
      ];

      // Add file parts if files are provided
      if (input.files && input.files.length > 0) {
        for (const file of input.files) {
          parts.push({
            type: "file",
            url: file.path,
            mediaType: file.media_type,
            filename: file.name,
          });
        }
      }

      const message: AssistantUIMessage = {
        id: bytesToHex(randomBytes(16)),
        role: "user",
        parts,
        metadata: {
          threadId: chatId,
          createdAt: now.toISOString(),
        },
      };

      // Create the chat with the first message and workflow link (Spec 09)
      await this.chatStore.createChat({ chatId, message, workflowId }, tx);

      // Save to chat_messages table (Spec 12)
      await this.chatStore.saveChatMessage({
        id: message.id,
        chat_id: chatId,
        role: 'user',
        content: JSON.stringify(message),
        timestamp: now.toISOString(),
        task_run_id: '',
        script_id: '',
        failed_script_run_id: '',
      }, tx);

      // Task (Spec 10: workflow_id and asks set at creation)
      const task: Task = {
        id: taskId,
        timestamp,
        reply: "",
        state: "",
        thread_id: "",
        error: "",
        type: "planner",
        title: input.title || "",
        chat_id: chatId,
        workflow_id: workflowId,  // Direct link to workflow (Spec 10)
        asks: "",                  // Initialized empty (Spec 10)
      };

      // Create new task with type=planner and chat_id=chatId
      await this.taskStore.addTask(
        task,
        tx // pass transaction
      );

      const workflow: Workflow = {
        id: workflowId,
        cron: "",
        events: "",
        status: "draft",  // Explicit status (Spec 11)
        task_id: taskId,
        chat_id: chatId,  // Direct link to chat (Spec 09)
        timestamp: now.toISOString(),
        title: task.title,
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",  // No active script yet, will be set when first script is saved
        handler_config: "",  // Will be set when script is saved (exec-05)
      };

      // Create the matching workflow
      await this.scriptStore.addWorkflow(
        workflow,
        tx // pass transaction
      );

      // Send message to the new task's inbox
      const inboxItem: InboxItem = {
        id: message.id,
        source: "user",
        source_id: message.id,
        target: task.type as TaskType,
        target_id: task.id,
        timestamp: now.toISOString(),
        content: JSON.stringify(message),
        handler_thread_id: "",
        handler_timestamp: "",
      };
      await this.inboxStore.saveInbox(inboxItem, tx);

      return { chatId, taskId };
    });
  }

  /**
   * Enter maintenance mode for a workflow when a logic error occurs.
   * This atomically:
   * 1. Increments workflow.maintenance_fix_count
   * 2. Sets workflow.maintenance = true
   * 3. Creates a new maintainer task (with empty chat_id, own thread_id)
   * 4. Creates an inbox item targeting the maintainer task
   *
   * All operations succeed or fail together.
   *
   * @param params - The workflow and script run info for the maintenance request
   * @returns The created maintainer task, inbox item ID, and new fix count
   */
  async enterMaintenanceMode(
    params: EnterMaintenanceModeParams
  ): Promise<EnterMaintenanceModeResult> {
    const { workflowId, workflowTitle, scriptRunId } = params;

    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const timestamp = Math.floor(now.getTime() / 1000);

      // 1. Increment fix count
      const newFixCount = await this.scriptStore.incrementMaintenanceFixCount(workflowId, tx);

      // 2. Set maintenance flag
      await this.scriptStore.setWorkflowMaintenance(workflowId, true, tx);

      // 3. Create maintainer task
      const taskId = bytesToHex(randomBytes(16));
      const threadId = bytesToHex(randomBytes(16));

      const maintainerTask: Task = {
        id: taskId,
        timestamp,
        reply: "",
        state: "",
        thread_id: threadId,  // Own thread for isolation
        error: "",
        type: "maintainer",
        title: `Auto-fix: ${workflowTitle}`,
        chat_id: "",  // Maintainer does NOT write to user-facing chat
        workflow_id: workflowId,
        asks: "",
      };

      await this.taskStore.addTask(maintainerTask, tx);

      // 4. Create inbox item targeting the maintainer task
      const inboxItemId = `maintenance.${workflowId}.${scriptRunId}.${bytesToHex(randomBytes(8))}`;
      const inboxItem: InboxItem = {
        id: inboxItemId,
        source: "script",
        source_id: scriptRunId,
        target: "maintainer",
        target_id: taskId,
        timestamp: now.toISOString(),
        content: JSON.stringify({
          role: "user",
          parts: [{
            type: "text",
            text: "A logic error occurred. Analyze and fix the script.",
          }],
          metadata: {
            scriptRunId: scriptRunId,
          },
        }),
        handler_thread_id: "",
        handler_timestamp: "",
      };

      await this.inboxStore.saveInbox(inboxItem, tx);

      return { maintainerTask, inboxItemId, newFixCount };
    });
  }
}
