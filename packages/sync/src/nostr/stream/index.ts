/**
 * NIP-173 (Streaming Over Nostr) implementation
 */

// Export types
export * from './types';

// Export StreamWriter
export { StreamWriter } from './StreamWriter';

// Export StreamReader and StreamReaderError
export { StreamReader, StreamReaderError } from './StreamReader';

// Export StreamFactory
export { DefaultStreamFactory, getStreamFactory } from './DefaultStreamFactory';
export type { StreamFactory, StreamWriterInterface } from './interfaces';

// Export FileSender and FileReceiver
export { FileSender, UPLOAD_KIND, UPLOAD_READY_KIND, DOWNLOAD_KIND } from './FileSender';
export type { UploadParams } from './FileSender';
export { FileReceiver } from './FileReceiver';
export type { DownloadResult } from './FileReceiver';

// Export Encryption
export {
  DefaultEncryption,
  getEncryption,
  ENCRYPTION_NONE,
  ENCRYPTION_NIP44,
  ENCRYPTION_NIP44_V3,
  EncryptionError,
  MAX_PAYLOAD_SIZE_NIP44,
  MAX_PAYLOAD_SIZE_NIP44_BIN,
  MAX_PAYLOAD_SIZE_NIP44_V3,
  MAX_PAYLOAD_SIZE_NIP44_V3_BIN
} from './encryption';

// Export Metadata functions
export {
  createStreamMetadataEvent,
  parseStreamMetadataEvent
} from './metadata';

// Export common functions
export {
  createEvent,
  validateNostrEvent,
  DEFAULT_RELAYS,
  publishToRelays
} from './common';