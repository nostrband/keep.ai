// Database write hooks using TanStack Query mutations
import { useMutation } from "@tanstack/react-query";
import { notifyTablesChanged, queryClient } from "../queryClient";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";

export function useAddMessage() {
  const { api } = useCRSqliteQuery();

  return useMutation({
    mutationFn: async (input: {
      threadId: string;
      role: "user" | "assistant";
      content: string;
      userId?: string;
    }) => {
      if (!api) throw new Error("Memory store not available");
      if (input.userId && api.userId !== input.userId)
        throw new Error("Wrong user id");

      const message = await api.addMessage({
        threadId: input.threadId,
        role: input.role,
        content: input.content,
      });

      return {
        id: message.id,
        thread_id: input.threadId,
        user_id: api.userId,
        role: input.role,
        content: input.content,
        created_at: message.metadata?.createdAt || "",
      };
    },
    // onMutate: async ({ threadId, role, content, userId = 'default-user' }) => {
    //   await queryClient.cancelQueries({ queryKey: qk.threadMessages(threadId) });

    //   const messagesKey = qk.threadMessages(threadId);
    //   const prevMessages = queryClient.getQueryData<any[]>(messagesKey) ?? [];

    //   const optimistic = {
    //     id: `opt_${Date.now()}`,
    //     thread_id: threadId,
    //     user_id: userId,
    //     role,
    //     content,
    //     created_at: new Date().toISOString()
    //   };

    //   queryClient.setQueryData(messagesKey, [...prevMessages, optimistic]);

    //   return { messagesKey, prevMessages };
    // },
    // onError: (_err, _vars, ctx) => {
    //   if (ctx) {
    //     queryClient.setQueryData(ctx.messagesKey, ctx.prevMessages);
    //   }
    // },
    onSuccess: (_result, { threadId }) => {
      // Invalidate to get fresh data from DB
      queryClient.invalidateQueries({ queryKey: qk.threadMessages(threadId) });
      queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });

      notifyTablesChanged(["messages", "threads"]);
    },
  });
}
