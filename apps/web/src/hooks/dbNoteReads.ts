// Database note read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";
import type { Note, NoteListItem } from "@app/db";

export function useNotes() {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allNotes(),
    queryFn: async () => {
      if (!api) return [];
      return await api.noteStore.listNotes();
    },
    meta: { tables: ["notes"] },
    enabled: !!api,
  });
}

export function useNote(noteId: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.note(noteId),
    queryFn: async () => {
      if (!api) return null;
      return await api.noteStore.getNote(noteId);
    },
    meta: { tables: ["notes"] },
    enabled: !!api && !!noteId,
  });
}

export function useSearchNotes(query?: {
  keywords?: string[];
  tags?: string[];
  regexp?: string;
}) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.searchNotes(query),
    queryFn: async () => {
      if (!api) return [];
      return await api.noteStore.searchNotes(query);
    },
    meta: { tables: ["notes"] },
    enabled: !!api,
  });
}