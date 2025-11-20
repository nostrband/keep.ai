// Database nostr peer read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useNostrPeers() {
  const { api } = useDbQuery();
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
  const { api } = useDbQuery();
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