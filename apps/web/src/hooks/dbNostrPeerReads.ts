// Database nostr peer read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useCRSqliteQuery } from "../QueryProvider";
import type { NostrPeer } from "@app/db";

export function useNostrPeers() {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.allNostrPeers(),
    queryFn: async () => {
      if (!api) return [];
      return await api.nostrPeerStore.listPeers();
    },
    meta: { tables: ["nostr_peers"] },
    enabled: !!api,
  });
}

export function useNostrPeer(peerPubkey: string) {
  const { api } = useCRSqliteQuery();
  return useQuery({
    queryKey: qk.nostrPeer(peerPubkey),
    queryFn: async () => {
      if (!api) return null;
      return await api.nostrPeerStore.getPeer(peerPubkey);
    },
    meta: { tables: ["nostr_peers"] },
    enabled: !!api && !!peerPubkey,
  });
}