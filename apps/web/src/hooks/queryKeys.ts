// Query keys for TanStack Query with stable keys and table dependencies
export const qk = {
  // Thread-related queries
  threadMessages: (threadId: string) => [{ scope: "threadMessages", threadId }] as const,
  thread: (threadId: string) => [{ scope: "thread", threadId }] as const,
  allThreads: () => [{ scope: "allThreads" }] as const,
  
  // Chat-related queries
  chatMessages: (chatId: string) => [{ scope: "chatMessages", chatId }] as const,
  chatEvents: (chatId: string) => [{ scope: "chatEvents", chatId }] as const,
  chat: (chatId: string) => [{ scope: "chat", chatId }] as const,
  allChats: () => [{ scope: "allChats" }] as const,
  
  // Message-related queries
  messageById: (id: string) => [{ scope: "messageById", id }] as const,
  
  // Task-related queries
  allTasks: (includeFinished: boolean) => [{ scope: "allTasks", includeFinished }] as const,
  task: (taskId: string) => [{ scope: "task", taskId }] as const,
  taskState: (taskId: string) => [{ scope: "taskState", taskId }] as const,
  taskRuns: (taskId: string) => [{ scope: "taskRuns", taskId }] as const,
  taskRun: (runId: string) => [{ scope: "taskRun", runId }] as const,
  taskByChatId: (chatId: string) => [{ scope: "taskByChatId", chatId }] as const,
  
  // Note-related queries
  allNotes: () => [{ scope: "allNotes" }] as const,
  note: (noteId: string) => [{ scope: "note", noteId }] as const,
  searchNotes: (query?: { keywords?: string[]; tags?: string[]; regexp?: string; }) => [{ scope: "searchNotes", query }] as const,
  
  // Agent-related queries
  agentStatus: () => [{ scope: "agentStatus" }] as const,
  
  // Nostr peer-related queries
  allNostrPeers: () => [{ scope: "allNostrPeers" }] as const,
  nostrPeer: (peerPubkey: string) => [{ scope: "nostrPeer", peerPubkey }] as const,
  
  // Inbox-related queries
  inboxItems: (options?: { source?: string; target?: string; handled?: boolean; limit?: number; }) => [{ scope: "inboxItems", options }] as const,
  inboxItem: (id: string) => [{ scope: "inboxItem", id }] as const,
  
  // File-related queries
  allFiles: () => [{ scope: "allFiles" }] as const,
  file: (fileId: string) => [{ scope: "file", fileId }] as const,
  searchFiles: (query: string) => [{ scope: "searchFiles", query }] as const,
  filesByMediaType: (mediaType: string) => [{ scope: "filesByMediaType", mediaType }] as const,
  
  // Script-related queries
  allScripts: () => [{ scope: "allScripts" }] as const,
  script: (scriptId: string) => [{ scope: "script", scriptId }] as const,
  scriptVersions: (taskId: string) => [{ scope: "scriptVersions", taskId }] as const,
  latestScript: (taskId: string) => [{ scope: "latestScript", taskId }] as const,
  scriptRuns: (scriptId: string) => [{ scope: "scriptRuns", scriptId }] as const,
  scriptRun: (runId: string) => [{ scope: "scriptRun", runId }] as const,
  
  // Workflow-related queries
  allWorkflows: () => [{ scope: "allWorkflows" }] as const,
  workflow: (workflowId: string) => [{ scope: "workflow", workflowId }] as const,
  workflowByTaskId: (taskId: string) => [{ scope: "workflowByTaskId", taskId }] as const,
  workflowScripts: (workflowId: string) => [{ scope: "workflowScripts", workflowId }] as const,
  workflowScriptRuns: (workflowId: string) => [{ scope: "workflowScriptRuns", workflowId }] as const,
  latestWorkflowScript: (workflowId: string) => [{ scope: "latestWorkflowScript", workflowId }] as const,
};