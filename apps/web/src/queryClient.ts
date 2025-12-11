// Query client configuration with table-based invalidation
import { QueryClient } from "@tanstack/react-query";
import { messageNotifications } from "./lib/MessageNotifications";
import type { KeepDbApi } from "@app/db";

declare const __SERVERLESS__: boolean;
const isServerless = __SERVERLESS__;

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
export function notifyTablesChanged(
  tables: string[],
  isLocalChange: boolean,
  api: KeepDbApi
) {
  console.log("notifyTablesChanged", tables, isLocalChange, globalThis);
  const set = new Set(tables);
  queryClient.invalidateQueries({
    predicate(q) {
      const meta = q.meta as any;
      if (!meta) return false;

      const t = meta.tables as string[] | undefined;
      if (!t) return false;

      const queryTables = t.filter((x) => set.has(x));
      if (!queryTables.length) return false;

      if (meta.onTablesUpdate) {
        // Custom handler
        meta
          .onTablesUpdate(queryTables)
          .catch((e: any) => console.log("error", e));
        return false;
      } else {
        // Invalidate
        return true;
      }
    },
  });

  // If this is a local change, trigger sync
  if (isLocalChange && onLocalChangesCallback) {
    onLocalChangesCallback();
  }

  if (!isServerless && !isLocalChange && globalThis === window) {
    // Check for new messages and show notifications
    messageNotifications.checkNewMessages(api).catch((error) => {
      console.debug("Message notifications failed:", error);
    });
  }
}
