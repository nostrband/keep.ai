/**
 * FileReceiver implementation for file download via NIP-173 streaming
 *
 * Handles receiving files over Nostr using streaming protocol with the following flow:
 * 1. Listens for upload events (kind 24690)
 * 2. Sends upload_ready response (kind 24691)
 * 3. Uses StreamReader to receive file data via NIP-173 protocol
 */

import { SimplePool, Event, Filter, UnsignedEvent } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { NostrSigner } from "../NostrTransport";
import { StreamFactory } from "./interfaces";
import { parseStreamMetadataEvent } from "./metadata";
import { DEFAULT_RELAYS } from "./common";
import { publish } from "../index";
import debug from "debug";

const debugFile = debug("sync:file-receiver");

// Event kinds for file upload protocol
export const UPLOAD_KIND = 24690;
export const UPLOAD_READY_KIND = 24691;
export const DOWNLOAD_KIND = 24692;

export interface DownloadResult {
  stream: AsyncIterable<string | Uint8Array>;
  mimeType?: string;
}

interface PendingDownload {
  downloadId: string;
  file_path: string;
  resolve: (result: DownloadResult) => void;
  reject: (error: Error) => void;
  ttlTimer: ReturnType<typeof setTimeout>;
}

export class FileReceiver {
  private signer: NostrSigner;
  private pool: SimplePool;
  private factory: StreamFactory;
  private localPubkey: string;
  private peerPubkey: string;
  private relays: string[];
  private onUpload?: (
    filename: string,
    stream: AsyncIterable<string | Uint8Array>,
    mimeType?: string
  ) => Promise<void>;
  private subscription: { close: () => void } | null = null;
  private started = false;
  private pendingDownloads = new Map<string, PendingDownload>();

  constructor({
    signer,
    pool,
    factory,
    localPubkey,
    peerPubkey,
    onUpload,
    relays = DEFAULT_RELAYS,
  }: {
    signer: NostrSigner;
    pool: SimplePool;
    factory: StreamFactory;
    localPubkey: string;
    peerPubkey: string;
    relays?: string[];
    onUpload?: (
      filename: string,
      stream: AsyncIterable<string | Uint8Array>,
      mimeType?: string
    ) => Promise<void>;
  }) {
    this.signer = signer;
    this.pool = pool;
    this.factory = factory;
    this.localPubkey = localPubkey;
    this.peerPubkey = peerPubkey;
    this.relays = relays;
    this.onUpload = onUpload;
  }

  /**
   * Starts listening for upload events
   */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    debugFile("Starting FileReceiver for pubkey:", this.localPubkey);

    // Subscribe to upload events from peer
    const filter: Filter = {
      kinds: [UPLOAD_KIND],
      authors: [this.peerPubkey],
    };

    this.subscription = this.pool.subscribeMany(this.relays, filter, {
      onevent: async (event) => {
        try {
          await this.handleUploadEvent(event);
        } catch (error) {
          debugFile("Error handling upload event:", error);
        }
      },
    });

    debugFile("Subscribed to upload events");
  }

  /**
   * Stops the file receiver and cleans up resources
   */
  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    // Clear pending downloads and reject them
    for (const pending of this.pendingDownloads.values()) {
      clearTimeout(pending.ttlTimer);
      pending.reject(new Error("FileReceiver stopped"));
    }
    this.pendingDownloads.clear();

    debugFile("FileReceiver stopped");
  }

  /**
   * Downloads a file from a peer
   *
   * @param file_path - Path to the file to download
   * @returns Promise that resolves with an object containing the reader and optional mimeType
   */
  async download(
    file_path: string
  ): Promise<DownloadResult> {
    if (!this.started) {
      throw new Error("FileReceiver not started. Call start() first.");
    }

    debugFile("Requesting download for file:", file_path);

    // Create download event (kind 24692)
    const downloadPayload = { file_path };
    const encryptedContent = await this.signer.encrypt({
      plaintext: JSON.stringify(downloadPayload),
      receiverPubkey: this.peerPubkey,
      senderPubkey: this.localPubkey,
    });

    const unsignedEvent: UnsignedEvent = {
      kind: DOWNLOAD_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: encryptedContent,
      pubkey: this.localPubkey,
    };

    const downloadEvent = await this.signer.signEvent(unsignedEvent);

    // Create promise that will be resolved/rejected when download completes
    return new Promise<DownloadResult>((resolve, reject) => {
        // Store pending download with TTL
        const ttlTimer = setTimeout(() => {
          this.pendingDownloads.delete(downloadEvent.id);
          debugFile("Download request timed out for:", file_path);
          reject(new Error("Download request timed out after 60 seconds"));
        }, 60000);

        const pendingDownload: PendingDownload = {
          downloadId: downloadEvent.id,
          file_path,
          resolve,
          reject,
          ttlTimer,
        };

        this.pendingDownloads.set(downloadEvent.id, pendingDownload);

        // Publish download request
        publish(downloadEvent, this.pool, this.relays)
          .then(() => {
            debugFile("Published download request to relays");
          })
          .catch((error) => {
            this.pendingDownloads.delete(downloadEvent.id);
            clearTimeout(ttlTimer);
            reject(
              new Error("Failed to publish download request to any relay")
            );
          });
      }
    );
  }

  private async processUploadEvent(
    event: Event,
    resolve: (
      filename: string,
      stream: AsyncIterable<Uint8Array | string>,
      mimeType?: string
    ) => void,
    reject?: (err: any) => void
  ) {
    // Extract metadata tag
    const metadataTag = event.tags.find((tag) => tag[0] === "metadata");
    if (!metadataTag || !metadataTag[1]) {
      debugFile("Upload event missing metadata tag");
      return;
    }

    // Decrypt metadata event
    const decryptedMetadata = await this.signer.decrypt({
      ciphertext: metadataTag[1],
      receiverPubkey: this.localPubkey,
      senderPubkey: this.peerPubkey,
    });

    const metadataEvent = JSON.parse(decryptedMetadata) as Event;

    // Parse stream metadata from the metadata event
    const streamMetadata = parseStreamMetadataEvent(metadataEvent);

    // Extract filename and mime type from metadata event tags
    const filenameTag = metadataEvent.tags.find((tag) => tag[0] === "filename");
    const filename = filenameTag ? filenameTag[1] : "unknown";
    
    const mimeTag = metadataEvent.tags.find((tag) => tag[0] === "mime");
    const mimeType = mimeTag ? mimeTag[1] : undefined;

    debugFile("Received upload for file:", filename, "mimeType:", mimeType);

    // Decrypt receiver private key from event content
    const decryptedContent = await this.signer.decrypt({
      ciphertext: event.content,
      receiverPubkey: this.localPubkey,
      senderPubkey: this.peerPubkey,
    });

    const { receiver_privkey } = JSON.parse(decryptedContent);
    if (!receiver_privkey || typeof receiver_privkey !== "string") {
      throw new Error("Invalid receiver private key in upload event");
    }

    const receiverPrivkey = hexToBytes(receiver_privkey);

    // Add receiver private key to stream metadata for decryption
    streamMetadata.receiver_privkey = receiverPrivkey;

    debugFile("Creating stream reader for:", filename);

    // Send upload_ready response
    await this.sendUploadReady(event.id);

    try {
      // Create reader using the factory
      const reader = await this.factory.createReader(streamMetadata, this.pool);

      // Resolve the download promise with the reader and mimeType
      resolve(filename, reader, mimeType);

      debugFile("Upload reader started for:", filename);
    } catch (readerError) {
      debugFile("Failed to create reader:", readerError);
      reject?.(
        readerError instanceof Error
          ? readerError
          : new Error(String(readerError))
      );
    }
  }

  private async handleUploadEvent(event: Event): Promise<void> {
    debugFile("Received upload event:", event.id);

    // Extract download_id from 'e' tag
    const eTag = event.tags.find((tag) => tag[0] === "e");
    if (!eTag || !eTag[1]) {
      if (!this.onUpload) {
        // We don't support peer-initiated uploads
        debugFile("Upload event missing e tag");
        return;
      } else {
        // Peer uploads file
        debugFile("Received peer-initiated upload", event.id);
        try {
          await this.processUploadEvent(event, (filename, stream, mimeType) => {
            return this.onUpload!(filename, stream, mimeType);
          });
        } catch (err: any) {
          debugFile("Failed to receive upload", event.id, err);
        }
      }
    } else {
      // We requested this file
      const downloadId = eTag[1];
      const pendingDownload = this.pendingDownloads.get(downloadId);

      if (!pendingDownload) {
        debugFile("No pending download found for event:", downloadId);
        return;
      }

      // Clean up the pending download
      this.pendingDownloads.delete(downloadId);
      clearTimeout(pendingDownload.ttlTimer);

      debugFile("Downloading file", pendingDownload.file_path);
      try {
        await this.processUploadEvent(
          event,
          (_, stream, mimeType) => pendingDownload?.resolve({ stream, mimeType }),
          pendingDownload.reject
        );
      } catch (error) {
        debugFile("Failed to handle upload event:", error);

        // If we have the pending download, reject it
        if (pendingDownload) {
          pendingDownload.reject(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
  }

  private async sendUploadReady(uploadEventId: string): Promise<void> {
    debugFile("Sending upload_ready for event:", uploadEventId);

    // Create upload_ready event (kind 24691)
    const unsignedEvent: UnsignedEvent = {
      kind: UPLOAD_READY_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", uploadEventId], // Reference to the upload event
      ],
      content: "",
      pubkey: this.localPubkey,
    };

    const uploadReadyEvent = await this.signer.signEvent(unsignedEvent);

    // Publish to relays using proper publish method
    try {
      await publish(uploadReadyEvent, this.pool, this.relays);
      debugFile("Published upload_ready event to relays");
    } catch (error) {
      debugFile("Failed to publish upload_ready event to any relay");
      throw new Error("Failed to publish upload_ready event");
    }
  }
}
