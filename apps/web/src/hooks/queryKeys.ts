// Query keys for TanStack Query with stable keys and table dependencies
export const qk = {
  // Thread-related queries
  threadMessages: (threadId: string) => [{ scope: "threadMessages", threadId }] as const,
  thread: (threadId: string) => [{ scope: "thread", threadId }] as const,
  
  // Message-related queries
  messageById: (id: string) => [{ scope: "messageById", id }] as const,
};