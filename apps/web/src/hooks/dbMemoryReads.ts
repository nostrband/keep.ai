// Database memory read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";

export function useWorkingMemory() {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.workingMemory(),
    queryFn: async () => {
      if (!api) return null;
      const resource = await api.memoryStore.getResource();
      return resource?.workingMemory || "";
    },
    meta: { tables: ["resources"] },
    enabled: !!api,
  });
}