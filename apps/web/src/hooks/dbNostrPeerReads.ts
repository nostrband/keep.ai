// Database nostr peer read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";

export function useLocalSiteId() {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: ["localSiteId"],
    queryFn: async () => {
      if (!api) return null;
      const result = await api.db.db.execO<{ site_id: string }>(
        "SELECT crsql_site_id() as site_id"
      );
      return result?.[0]?.site_id || null;
    },
    enabled: !!api,
  });
}

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