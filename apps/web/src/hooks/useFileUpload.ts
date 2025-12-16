import { useState, useMemo } from "react";
import { useNostrPeers, useLocalSiteId } from "./dbNostrPeerReads";
import { useFiles } from "./dbFileReads";
import { API_ENDPOINT } from "../const";
import { DEFAULT_RELAYS, FileSender, getStreamFactory } from "@app/sync";
import { getDefaultCompression } from "@app/browser";
import { SimplePool, getPublicKey } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { ServerlessNostrSigner } from "../lib/signer";
import { type File as DbFile } from "@app/db";

declare const __SERVERLESS__: boolean;
const isServerless = __SERVERLESS__;

// Helper function to determine if file should use no compression
const shouldUseNoCompression = (fileName: string): boolean => {
  const extension = fileName.toLowerCase().split(".").pop();
  if (!extension) return false;

  const imageExtensions = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "webp",
    "svg",
    "tiff",
    "ico",
    "heic",
    "heif",
  ];
  const audioExtensions = [
    "mp3",
    "wav",
    "flac",
    "aac",
    "ogg",
    "m4a",
    "wma",
    "opus",
  ];
  const videoExtensions = [
    "mp4",
    "avi",
    "mov",
    "mkv",
    "wmv",
    "flv",
    "webm",
    "m4v",
    "ogv",
  ];

  return (
    imageExtensions.includes(extension) ||
    audioExtensions.includes(extension) ||
    videoExtensions.includes(extension)
  );
};

export interface FileUploadProgress {
  fileIndex: number;
  fileName: string;
  progress: number;
}

export interface FileUploadState {
  isUploading: boolean;
  uploadProgress: FileUploadProgress | null;
  error: string | null;
}

export function useFileUpload() {
  const { data: allNostrPeers = [] } = useNostrPeers();
  const { data: localSiteId } = useLocalSiteId();
  const { refetch: refetchFiles } = useFiles();

  // Filter peers by local_id (same logic as server.ts)
  const nostrPeers = useMemo(() => {
    if (!localSiteId) return [];
    return allNostrPeers.filter((p) => p.local_id === localSiteId);
  }, [allNostrPeers, localSiteId]);

  const [uploadState, setUploadState] = useState<FileUploadState>({
    isUploading: false,
    uploadProgress: null,
    error: null,
  });

  // Create async iterable from file for FileSender
  async function* createFileDataSource(
    file: File,
    fileIndex: number,
    fileName: string
  ): AsyncIterable<Uint8Array> {
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();
      yield new Uint8Array(arrayBuffer);
      offset += chunkSize;

      // Update progress
      const progress = Math.min((offset / file.size) * 100, 100);
      setUploadState((prev) => ({
        ...prev,
        uploadProgress: {
          fileIndex,
          fileName,
          progress,
        },
      }));
    }
  }

  // Serverless upload using FileSender
  const uploadFileServerless = async (
    file: File,
    fileIndex: number
  ): Promise<DbFile> => {
    try {
      // Check if we have exactly one peer
      if (nostrPeers.length !== 1) {
        throw new Error(`Expected 1 peer, found ${nostrPeers.length}`);
      }

      const peer = nostrPeers[0];

      // Get local private key from localStorage
      const localKey = localStorage.getItem("local_key");
      if (!localKey) {
        throw new Error("No local key found");
      }

      const localPrivkey = hexToBytes(localKey);
      const localPubkey = getPublicKey(localPrivkey);
      const peerPubkey = peer.peer_pubkey;

      // Create signer
      const signer = new ServerlessNostrSigner();
      signer.setKey(localPrivkey);

      // Create pool
      const pool = new SimplePool({
        enablePing: false,
        enableReconnect: true,
      });

      // Create stream factory
      const factory = getStreamFactory();
      factory.compression = getDefaultCompression();

      // Determine compression based on file type
      const compression = shouldUseNoCompression(file.name) ? "none" : "gzip";

      // Create FileSender
      const fileSender = new FileSender({
        signer,
        pool,
        factory,
        compression,
        encryption: "nip44_v3",
        localPubkey,
        peerPubkey,
        relays: DEFAULT_RELAYS,
      });

      // Start FileSender
      fileSender.start();

      try {
        // Create file data source
        const source = createFileDataSource(file, fileIndex, file.name);

        // Upload file
        const fileRecord: DbFile = await fileSender.upload(
          { filename: file.name },
          source
        );

        console.log("File uploaded successfully via nostr:", file.name, fileRecord);

        // Refresh file list to get the new file record
        await refetchFiles();

        // Return server-side info like the one upload API returns 
        return fileRecord;
      } finally {
        // Clean up
        fileSender.stop();
        pool.destroy();
      }
    } catch (error) {
      console.error("Serverless upload failed:", error);
      throw error;
    }
  };

  // Regular upload using API
  const uploadFileAPI = async (
    file: File,
    fileIndex: number
  ): Promise<DbFile> => {
    const formData = new FormData();
    formData.append("file", file);

    return new Promise<DbFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          setUploadState((prev) => ({
            ...prev,
            uploadProgress: {
              fileIndex,
              fileName: file.name,
              progress,
            },
          }));
        }
      };

      // Handle response
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            // Refresh file list
            refetchFiles();
            resolve(response);
          } catch (parseError) {
            reject(new Error("Failed to parse upload response"));
          }
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            reject(new Error(errorResponse.error || "Upload failed"));
          } catch {
            reject(new Error("Upload failed with status: " + xhr.status));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network error during upload"));
      };

      // Start the upload
      xhr.open("POST", `${API_ENDPOINT}/file/upload`);
      xhr.send(formData);
    });
  };

  // Upload multiple files
  const uploadFiles = async (files: File[]): Promise<DbFile[]> => {
    if (files.length === 0) return [];

    // Reset states
    setUploadState({
      isUploading: true,
      uploadProgress: null,
      error: null,
    });

    const results: DbFile[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        let result: DbFile;
        if (isServerless) {
          result = await uploadFileServerless(file, i);
        } else {
          result = await uploadFileAPI(file, i);
        }

        results.push(result);
      }

      // Success
      setUploadState({
        isUploading: false,
        uploadProgress: null,
        error: null,
      });

      return results;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setUploadState({
        isUploading: false,
        uploadProgress: null,
        error: errorMessage,
      });
      throw error;
    }
  };

  return {
    uploadFiles,
    uploadState,
    clearError: () => setUploadState((prev) => ({ ...prev, error: null })),
  };
}
