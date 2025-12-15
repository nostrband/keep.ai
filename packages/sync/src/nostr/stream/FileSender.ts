/**
 * FileSender implementation for file upload via NIP-173 streaming
 * 
 * Handles sending files over Nostr using streaming protocol with the following flow:
 * 1. Creates upload request event (kind 24690) with encrypted metadata and receiver key
 * 2. Waits for upload_ready response (kind 24691)
 * 3. Uses StreamWriter to send file data via NIP-173 protocol
 */

import { SimplePool, generateSecretKey, getPublicKey, Event, Filter, UnsignedEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import { NostrSigner } from '../NostrTransport';
import { StreamFactory } from './interfaces';
import { CompressionMethod, EncryptionMethod, StreamMetadata } from './types';
import { createStreamMetadataEvent } from './metadata';
import { createEvent, DEFAULT_RELAYS } from './common';
import { publish } from '../index';
import debug from 'debug';

const debugFile = debug('sync:file-sender');

// Event kinds for file upload protocol
export const UPLOAD_KIND = 24690;
export const UPLOAD_READY_KIND = 24691;
export const DOWNLOAD_KIND = 24692;

interface PendingUpload {
  uploadEventId: string;
  downloadId?: string;
  filename: string;
  mimeType?: string;
  source: AsyncIterable<Uint8Array>;
  senderPrivkey: Uint8Array;
  receiverPrivkey: Uint8Array;
  metadata: StreamMetadata;
  resolve: () => void;
  reject: (error: Error) => void;
  ttlTimer: ReturnType<typeof setTimeout>;
}

export interface UploadParams {
  filename: string;
  mimeType?: string;
}

export class FileSender {
  private signer: NostrSigner;
  private pool: SimplePool;
  private factory: StreamFactory;
  private compression: CompressionMethod;
  private encryption: EncryptionMethod;
  private localPubkey: string;
  private peerPubkey: string;
  private relays: string[];
  private pendingUploads = new Map<string, PendingUpload>();
  private subscription: { close: () => void } | null = null;
  private started = false;

  constructor({
    signer,
    pool,
    factory,
    compression = 'none',
    encryption = 'none',
    localPubkey,
    peerPubkey,
    relays = DEFAULT_RELAYS
  }: {
    signer: NostrSigner;
    pool: SimplePool;
    factory: StreamFactory;
    compression?: CompressionMethod;
    encryption?: EncryptionMethod;
    localPubkey: string;
    peerPubkey: string;
    relays?: string[];
  }) {
    this.signer = signer;
    this.pool = pool;
    this.factory = factory;
    this.compression = compression;
    this.encryption = encryption;
    this.localPubkey = localPubkey;
    this.peerPubkey = peerPubkey;
    this.relays = relays;
  }

  /**
   * Starts listening for upload_ready events and download requests
   * Must be called before upload()
   */
  start(onDownload?: (id: string, file_path: string) => void): void {
    if (this.started) {
      return;
    }

    this.started = true;
    debugFile('Starting FileSender for pubkey:', this.localPubkey);

    // Subscribe to upload_ready events and download requests    
    const filter: Filter = {
      kinds: [UPLOAD_READY_KIND, DOWNLOAD_KIND],
      authors: [this.peerPubkey]
    };

    this.subscription = this.pool.subscribeMany(this.relays, filter, {
      onevent: async (event) => {
        try {
          if (event.kind === UPLOAD_READY_KIND) {
            await this.handleUploadReadyEvent(event);
          } else if (event.kind === DOWNLOAD_KIND && onDownload) {
            await this.handleDownloadEvent(event, onDownload);
          }
        } catch (error) {
          debugFile('Error handling event:', error);
        }
      }
    });

    debugFile('Subscribed to upload_ready events');
  }

  /**
   * Stops the file sender and cleans up resources
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

    // Reject all pending uploads
    for (const upload of this.pendingUploads.values()) {
      clearTimeout(upload.ttlTimer);
      upload.reject(new Error('FileSender stopped'));
    }
    this.pendingUploads.clear();

    debugFile('FileSender stopped');
  }

  /**
   * Uploads a file to a peer
   *
   * @param params - Upload parameters containing filename and optional mimeType
   * @param source - Async iterable providing file data chunks
   * @param downloadId - Optional ID of the download request
   * @returns Promise that resolves when upload completes
   */
  async upload(
    params: UploadParams,
    source: AsyncIterable<Uint8Array>,
    downloadId?: string,
  ): Promise<void> {
    if (!this.started) {
      throw new Error('FileSender not started. Call start() first.');
    }

    const { filename, mimeType } = params;
    debugFile('Starting upload:', filename, 'mimeType:', mimeType, 'download_id:', downloadId);

    // Generate two nostr keys - sender key and receiver key
    const senderPrivkey = generateSecretKey();
    const senderPubkey = getPublicKey(senderPrivkey);
    const receiverPrivkey = generateSecretKey();
    const receiverPubkey = getPublicKey(receiverPrivkey);

    // Create stream metadata
    const metadata: StreamMetadata = {
      streamId: senderPubkey,
      version: '1',
      encryption: this.encryption,
      compression: this.compression,
      binary: true, // Files are binary
      receiver_pubkey: receiverPubkey,
      relays: this.relays
    };

    // Create stream metadata event (kind 173) with filename and optional mime tags
    const tags: string[][] = [['filename', filename]];
    if (mimeType) {
      tags.push(['mime', mimeType]);
    }
    const metadataEvent = createStreamMetadataEvent(metadata, senderPrivkey, tags);

    // Encrypt metadata event for peer
    const encryptedMetadata = await this.signer.encrypt({
      plaintext: JSON.stringify(metadataEvent),
      receiverPubkey: this.peerPubkey,
      senderPubkey: this.localPubkey
    });

    // Encrypt receiver private key for peer
    const encryptedReceiverPrivkey = await this.signer.encrypt({
      plaintext: JSON.stringify({ receiver_privkey: bytesToHex(receiverPrivkey) }),
      receiverPubkey: this.peerPubkey,
      senderPubkey: this.localPubkey
    });

    // Create upload event (kind 24690)
    const unsignedUploadEvent: UnsignedEvent = {
      kind: UPLOAD_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ...(downloadId ? [['e', downloadId]] : []),
        ['metadata', encryptedMetadata]
      ],
      content: encryptedReceiverPrivkey,
      pubkey: this.localPubkey
    };

    const uploadEvent = await this.signer.signEvent(unsignedUploadEvent);

    debugFile('Created upload event:', uploadEvent.id);

    // Publish upload event to relays
    try {
      await publish(uploadEvent, this.pool, this.relays);
      debugFile('Published upload event to relays');
    } catch (error) {
      throw new Error('Failed to publish upload event to any relay');
    }

    // Create promise that will be resolved/rejected when upload completes
    return new Promise<void>((resolve, reject) => {
      // Set TTL of 60 seconds
      const ttlTimer = setTimeout(() => {
        this.pendingUploads.delete(uploadEvent.id);
        reject(new Error('Upload request timed out after 60 seconds'));
      }, 60000);

      // Store pending upload
      const pendingUpload: PendingUpload = {
        uploadEventId: uploadEvent.id,
        downloadId,
        filename,
        mimeType,
        source,
        senderPrivkey,
        receiverPrivkey,
        metadata,
        resolve,
        reject,
        ttlTimer
      };

      this.pendingUploads.set(uploadEvent.id, pendingUpload);
      debugFile('Added pending upload:', uploadEvent.id);
    });
  }

  private async handleUploadReadyEvent(event: Event): Promise<void> {
    debugFile('Received upload_ready event:', event.id);

    // Extract referenced upload event ID from 'e' tag
    const eTag = event.tags.find(tag => tag[0] === 'e');
    if (!eTag || !eTag[1]) {
      debugFile('upload_ready event missing e tag');
      return;
    }

    const uploadEventId = eTag[1];
    const pendingUpload = this.pendingUploads.get(uploadEventId);

    if (!pendingUpload) {
      debugFile('No pending upload found for event:', uploadEventId);
      return;
    }

    debugFile('Found pending upload, starting stream for:', pendingUpload.filename);

    try {
      // Clean up the pending upload
      this.pendingUploads.delete(uploadEventId);
      clearTimeout(pendingUpload.ttlTimer);

      // Create writer using the factory
      const writer = await this.factory.createWriter(
        pendingUpload.metadata,
        this.pool,
        pendingUpload.senderPrivkey
      );

      // Stream the file data
      for await (const chunk of pendingUpload.source) {
        await writer.write(chunk);
      }

      // Mark as done
      await writer.write(new Uint8Array(), true);

      // Resolve the upload promise
      pendingUpload.resolve();
      debugFile('Upload completed successfully:', pendingUpload.filename);

    } catch (error) {
      debugFile('Upload failed:', error);
      pendingUpload.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async handleDownloadEvent(event: Event, onDownload: (id: string, file_path: string) => void): Promise<void> {
    debugFile('Received download event:', event.id);

    try {
      // Decrypt the download request content
      const decryptedContent = await this.signer.decrypt({
        ciphertext: event.content,
        receiverPubkey: this.localPubkey,
        senderPubkey: this.peerPubkey
      });

      const { file_path } = JSON.parse(decryptedContent);
      if (!file_path) {
        debugFile('Download event missing file_path');
        return;
      }

      debugFile('Download requested for file:', file_path);
      onDownload(event.id, file_path);

    } catch (error) {
      debugFile('Error handling download event:', error);
    }
  }
}