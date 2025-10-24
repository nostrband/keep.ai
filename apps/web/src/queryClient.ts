// Query client configuration with table-based invalidation
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 60_000,
      refetchOnWindowFocus: false,
      structuralSharing: true,
    },
  },
});

// Callback for when local changes occur
let onLocalChangesCallback: (() => void) | null = null;

export function setOnLocalChanges(callback: (() => void) | null) {
  onLocalChangesCallback = callback;
}

// Call this from your sync/applyChanges code.
export function notifyTablesChanged(tables: string[], isLocalChange = true) {
  console.log("notifyTablesChanged", tables);
  const set = new Set(tables);
  queryClient.invalidateQueries({
    predicate(q) {
      const t = (q.meta as any)?.tables as string[] | undefined;
      if (!t) return false;
      return t.some(x => set.has(x));
    },
  });

  // If this is a local change, trigger sync
  if (isLocalChange && onLocalChangesCallback) {
    onLocalChangesCallback();
  }
}