// Database file read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useFiles() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.allFiles(),
    queryFn: async () => {
      if (!api) return [];
      return await api.fileStore.listFiles();
    },
    meta: { tables: ["files"] },
    enabled: !!api,
  });
}

export function useFile(fileId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.file(fileId),
    queryFn: async () => {
      if (!api) return null;
      return await api.fileStore.getFile(fileId);
    },
    meta: { tables: ["files"] },
    enabled: !!api && !!fileId,
  });
}

export function useSearchFiles(query: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.searchFiles(query),
    queryFn: async () => {
      if (!api) return [];
      return await api.fileStore.searchFiles(query);
    },
    meta: { tables: ["files"] },
    enabled: !!api && !!query,
  });
}

export function useFilesByMediaType(mediaType: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.filesByMediaType(mediaType),
    queryFn: async () => {
      if (!api) return [];
      return await api.fileStore.listFiles(mediaType);
    },
    meta: { tables: ["files"] },
    enabled: !!api && !!mediaType,
  });
}