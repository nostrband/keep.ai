import { ChatStore, MemoryStore, NoteStore, TaskStore } from "@app/db";
import { makeAddTaskTool } from "./add-task";
import { makeSendMessageTool } from "./send-message";
import { makeListChatsTool } from "./list-chats";
import { makeListTasksTool } from "./list-tasks";
import { makeDeleteTaskTool } from "./delete-task";
import { makeCreateNoteTool } from "./create-note";
import { makeUpdateNoteTool } from "./update-note";
import { makeDeleteNoteTool } from "./delete-note";
import { makeGetNoteTool } from "./get-note";
import { makeSearchNotesTool } from "./search-notes";
import { makeListNotesTool } from "./list-notes";
import { makeGetWeatherTool } from "./get-weather";
import { makeWebSearchTool } from "./web-search";
import { makePatchWorkingMemoryTool } from "./patch-working-memory";
import { makeUpdateWorkingMemoryTool } from "./update-working-memory";

export interface ToolsetStores {
  chatStore: ChatStore;
  memoryStore: MemoryStore;
  noteStore: NoteStore;
  taskStore: TaskStore;
}

export function makeToolset(stores: ToolsetStores) {
  const { chatStore, memoryStore, noteStore, taskStore } = stores;

  return {
    sendMessageTool: makeSendMessageTool(chatStore, memoryStore),
    listChatsTool: makeListChatsTool(chatStore),
    addTaskTool: makeAddTaskTool(taskStore),
    listTasksTool: makeListTasksTool(taskStore),
    deleteTaskTool: makeDeleteTaskTool(taskStore),
    createNoteTool: makeCreateNoteTool(noteStore),
    updateNoteTool: makeUpdateNoteTool(noteStore),
    deleteNoteTool: makeDeleteNoteTool(noteStore),
    getNoteTool: makeGetNoteTool(noteStore),
    searchNotesTool: makeSearchNotesTool(noteStore),
    listNotesTool: makeListNotesTool(noteStore),
    getWeatherTool: makeGetWeatherTool(),
    webSearchTool: makeWebSearchTool(),
    patchWorkingMemoryTool: makePatchWorkingMemoryTool(memoryStore),
    updateWorkingMemoryTool: makeUpdateWorkingMemoryTool(memoryStore),
  };
}

export type Toolset = ReturnType<typeof makeToolset>;
