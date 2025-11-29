// Database nostr peer read hooks using TanStack Query
import { useQuery } from "@tanstack/react-query";
import { qk } from "./queryKeys";
import { useDbQuery } from "./dbQuery";
import { bytesToHex } from "nostr-tools/utils";
import { API_ENDPOINT } from "../const";

export function useLocalSiteId() {
  const { api } = useDbQuery();
  const isServerless = import.meta.env.VITE_FLAVOR === "serverless";

  return useQuery({
    queryKey: ["localSiteId"],
    queryFn: async () => {
      if (isServerless) {
        // For serverless, use local database
        if (!api) return null;
        const result = await api.db.db.execO<{ site_id: Uint8Array }>(
          "SELECT crsql_site_id() as site_id"
        );
        return bytesToHex(result?.[0]?.site_id || new Uint8Array());
      } else {
        // For frontend build, call the server API
        try {
          const response = await fetch(`${API_ENDPOINT}/id`);
          if (!response.ok) {
            throw new Error(`Failed to fetch site_id: ${response.statusText}`);
          }
          const data = await response.json();
          return data.site_id || null;
        } catch (error) {
          console.error("Failed to fetch site_id from server:", error);
          return null;
        }
      }
    },
    enabled: !isServerless || !!api,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes since site_id shouldn't change
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