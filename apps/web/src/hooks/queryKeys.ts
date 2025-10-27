// Query keys for TanStack Query with stable keys and table dependencies
export const qk = {
  // Thread-related queries
  threadMessages: (threadId: string) => [{ scope: "threadMessages", threadId }] as const,
  thread: (threadId: string) => [{ scope: "thread", threadId }] as const,
  allThreads: () => [{ scope: "allThreads" }] as const,
  
  // Chat-related queries
  chatMessages: (chatId: string) => [{ scope: "chatMessages", chatId }] as const,
  chat: (chatId: string) => [{ scope: "chat", chatId }] as const,
  allChats: () => [{ scope: "allChats" }] as const,
  
  // Message-related queries
  messageById: (id: string) => [{ scope: "messageById", id }] as const,
  
  // Task-related queries
  allTasks: (includeFinished: boolean) => [{ scope: "allTasks", includeFinished }] as const,
  task: (taskId: string) => [{ scope: "task", taskId }] as const,
  
  // Memory-related queries
  workingMemory: () => [{ scope: "workingMemory" }] as const,
  
  // Note-related queries
  allNotes: () => [{ scope: "allNotes" }] as const,
  note: (noteId: string) => [{ scope: "note", noteId }] as const,
  searchNotes: (query?: { keywords?: string[]; tags?: string[]; regexp?: string; }) => [{ scope: "searchNotes", query }] as const,
};