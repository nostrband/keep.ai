import React, { useCallback, useState, useMemo } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { parseConnectionString } from "@app/sync";
import { useNostrPeers, useLocalSiteId } from "../hooks/dbNostrPeerReads";
import { useDeletePeer } from "../hooks/dbWrites";
import SharedHeader from "./SharedHeader";
import { Button, Badge } from "../ui";
import { API_ENDPOINT } from "../const";

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrString: string;
  isWaitingForPeer: boolean;
}

function QRModal({
  isOpen,
  onClose,
  qrString,
  isWaitingForPeer,
}: QRModalProps) {
  const [qrDataUrl, setQrDataUrl] = React.useState<string>("");

  React.useEffect(() => {
    if (isOpen && qrString) {
      QRCode.toDataURL(qrString, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      })
        .then((url) => {
          setQrDataUrl(url);
        })
        .catch((error) => {
          console.error("Error generating QR code:", error);
        });
    }
  }, [isOpen, qrString]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Connect Device</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600 mb-4">
            Scan this QR code with another device to connect
          </p>

          {qrDataUrl && (
            <>
              <div className="inline-block border border-gray-200 rounded p-2">
                <img src={qrDataUrl} alt="QR Code" className="block" />
              </div>
              {isWaitingForPeer && (
                <div className="mt-4 flex flex-col items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  <span>Waiting for connection...</span>
                </div>
              )}
            </>
          )}

          <div className="mt-4 p-2 bg-gray-50 rounded text-xs font-mono break-all">
            {qrString}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const isServerless = import.meta.env.VITE_FLAVOR === "serverless";
  const { data: allPeers = [], isLoading } = useNostrPeers();
  const { data: localSiteId } = useLocalSiteId();
  const deletePeerMutation = useDeletePeer();
  const [isConnecting, setIsConnecting] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [peerToDelete, setPeerToDelete] = useState<{ pubkey: string; deviceInfo: string } | null>(null);
  const [expectedPeerPubkey, setExpectedPeerPubkey] = useState<string | null>(null);
  const [isAwaitingPeer, setIsAwaitingPeer] = useState(false);

  // Filter to show only remote peers (where peer_id !== localSiteId)
  const peers = useMemo(() => {
    if (!localSiteId) return [];
    return allPeers.filter(peer => peer.peer_id !== localSiteId);
  }, [allPeers, localSiteId]);

  const handleCloseQrModal = useCallback(() => {
    setQrModalOpen(false);
    setConnectionString("");
    setExpectedPeerPubkey(null);
    setIsAwaitingPeer(false);
  }, []);

  const handleConnectDevice = async () => {
    setIsConnecting(true);
    try {
      const response = await fetch(API_ENDPOINT + "/connect", {
        method: "POST",
        body: "{}"
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setConnectionString(data.str);
      try {
        const parsed = parseConnectionString(data.str);
        setExpectedPeerPubkey(parsed.peerPubkey);
        setIsAwaitingPeer(true);
      } catch (parseError) {
        console.error("Failed to parse connection string:", parseError);
        setExpectedPeerPubkey(null);
        setIsAwaitingPeer(false);
      }
      setQrModalOpen(true);
    } catch (error) {
      console.error("Error connecting device:", error);
      alert("Failed to create connection. Please try again.");
    } finally {
      setIsConnecting(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const formatPubkey = (pubkey: string) => {
    if (pubkey.length <= 16) return pubkey;
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  };

  const handleDeleteClick = (peer: { peer_pubkey: string; device_info: string }) => {
    setPeerToDelete({ pubkey: peer.peer_pubkey, deviceInfo: peer.device_info || "Unknown Device" });
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!peerToDelete || !allPeers) return;

    try {
      // Find the matching local peer (where local_pubkey === deleted_peer.peer_pubkey)
      const remotePeerPubkey = peerToDelete.pubkey;
      const matchingLocalPeer = allPeers.find(peer =>
        peer.local_pubkey === remotePeerPubkey
      );

      // Delete both the remote peer and its matching local peer
      const peersToDelete = [remotePeerPubkey];
      if (matchingLocalPeer) {
        peersToDelete.push(matchingLocalPeer.peer_pubkey);
      }

      await deletePeerMutation.mutateAsync(peersToDelete);
      setConfirmDeleteOpen(false);
      setPeerToDelete(null);
    } catch (error) {
      console.error("Error deleting peer:", error);
      alert("Failed to delete peer. Please try again.");
    }
  };

  const handleCancelDelete = () => {
    setConfirmDeleteOpen(false);
    setPeerToDelete(null);
  };

  React.useEffect(() => {
    if (!qrModalOpen || !expectedPeerPubkey) {
      return;
    }

    const hasMatchingPeer = allPeers.some(
      (peer) => peer.local_pubkey === expectedPeerPubkey
    );

    if (hasMatchingPeer) {
      handleCloseQrModal();
    }
  }, [peers, expectedPeerPubkey, qrModalOpen, handleCloseQrModal]);

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Devices" />

      {/* Main content */}
      <div className="pt-6 pb-6">
        <div className="max-w-4xl mx-auto px-6">
          {/* Connect device button */}
          {!isServerless && (
            <div className="mb-6 text-center">
              <Button
                onClick={handleConnectDevice}
                disabled={isConnecting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isConnecting ? "Connecting..." : "Connect Device"}
              </Button>
            </div>
          )}

          {/* Peer list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div>Loading devices...</div>
            </div>
          ) : (
            <div>
              {peers.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">
                    No connected devices found
                  </p>
                  <p className="text-sm text-gray-400">
                    Click "Connect Device" to add a new device
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Connected Devices ({peers.length})
                  </h2>
                  {peers.map((peer) => (
                    <div
                      key={peer.peer_pubkey}
                      className="p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-gray-900">
                              {peer.device_info || "Unknown Device"}
                            </h3>
                            <Badge variant="outline" className="text-xs">
                              Connected
                            </Badge>
                          </div>

                          <div className="space-y-1 text-sm text-gray-600">
                            <div>
                              <span className="font-medium">Peer ID:</span>{" "}
                              <span className="font-mono">
                                {formatPubkey(peer.peer_id)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Peer pubkey:</span>{" "}
                              <span className="font-mono">
                                {formatPubkey(peer.peer_pubkey)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Local ID:</span>{" "}
                              <span className="font-mono">
                                {formatPubkey(peer.local_id)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Local pubkey:</span>{" "}
                              <span className="font-mono">
                                {formatPubkey(peer.local_pubkey)}
                              </span>
                            </div>
                            {peer.relays && (
                              <div>
                                <span className="font-medium">Relays:</span>{" "}
                                <span className="text-xs">{peer.relays}</span>
                              </div>
                            )}
                            <div className="text-xs text-gray-500">
                              Connected: {formatTimestamp(peer.timestamp)}
                            </div>
                          </div>
                        </div>
                        
                        {/* Delete button */}
                        <div className="ml-4">
                          <button
                            onClick={() => handleDeleteClick(peer)}
                            disabled={deletePeerMutation.isPending}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors disabled:opacity-50"
                            title="Delete peer"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* QR Modal */}
      <QRModal
        isOpen={qrModalOpen}
        onClose={handleCloseQrModal}
        qrString={connectionString}
        isWaitingForPeer={isAwaitingPeer}
      />

      {/* Confirmation Dialog */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Delete Peer
              </h3>
              <p className="text-sm text-gray-600">
                Delete peer {peerToDelete?.deviceInfo}?
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                onClick={handleCancelDelete}
                variant="outline"
                disabled={deletePeerMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDelete}
                disabled={deletePeerMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deletePeerMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
