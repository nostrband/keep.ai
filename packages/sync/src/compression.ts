/**
 * Compression interfaces for NIP-173 streaming
 * These interfaces are shared between node and browser implementations
 */

// Compression methods
export const COMPRESSION_NONE = "none";
export const COMPRESSION_GZIP = "gzip";

export type CompressionMethod = typeof COMPRESSION_NONE | typeof COMPRESSION_GZIP | (string & {});

/**
 * Error thrown when compression or decompression result exceeds the maximum allowed size
 */
export class CompressionSizeLimitExceeded extends Error {
  constructor(currentSize: number, maxSize: number) {
    super(
      `Compression result size (${currentSize} bytes) exceeds the maximum allowed size (${maxSize} bytes)`
    );
    this.name = "CompressionSizeLimitExceeded";
  }
}

/**
 * Interface for streaming compression instance
 */
export interface CompressionInstance {
  /**
   * Max packet size allowed to be passed to 'add' to
   * ensure maxResultSize limit
   */
  maxChunkSize(): Promise<number | undefined>;

  /**
   * Adds a chunk to the compression stream
   *
   * NOTE: if CompressionSizeLimitExceeded is thrown, this chunk wasn't
   * compressed but you can still call 'finish()' to get the buffered
   * results and send the packet. This chunk can then be compressed
   * into a new archive.
   *
   * @param chunk - The chunk to process (string or Uint8Array)
   * @returns Promise resolving to the current size of the accumulated result
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   */
  add(chunk: string | Uint8Array): Promise<number>;

  /**
   * Finishes the compression stream and returns the result
   *
   * @returns Promise resolving to the final result as string or Uint8Array
   */
  finish(): Promise<string | Uint8Array>;

  /**
   * Disposes of resources used by the compression stream
   */
  dispose(): void;
}

/**
 * Interface for streaming decompression instance
 */
export interface DecompressionInstance {
  /**
   * Adds a chunk to the decompression stream
   *
   * NOTE: if CompressionSizeLimitExceeded is thrown, then these
   * buffered results aren't usable, and it's assumed client will reject
   * the whole archive, finish() will throw the same error in this case.
   *
   * @param chunk - The chunk to process as string or Uint8Array
   * @returns Promise resolving to the current size of the accumulated result
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   * @throws Error if input type doesn't match binary flag (string for non-binary, Uint8Array for binary)
   */
  add(chunk: string | Uint8Array): Promise<number>;

  /**
   * Finishes the decompression stream and returns the result, see notes in 'add' on
   * exceptional behavior.
   *
   * @returns Promise resolving to the final result as string or Uint8Array (if binary mode)
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   */
  finish(): Promise<string | Uint8Array>;

  /**
   * Disposes of resources used by the decompression stream
   */
  dispose(): void;
}

/**
 * Compression interface for NIP-173
 * Defines methods for compressing and decompressing data
 * Can be implemented to support custom compression methods
 */
export interface Compression {
  /**
   * Starts a streaming compression process
   *
   * @param method - The compression method
   * @param binary - Whether to accept binary data instead of string
   * @param maxResultSize - Optional maximum size (in bytes) for the compressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  startCompress(
    method: CompressionMethod,
    binary?: boolean,
    maxResultSize?: number
  ): Promise<CompressionInstance>;

  /**
   * Starts a streaming decompression process
   *
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @param maxResultSize - Optional maximum size (in bytes) for the decompressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A DecompressionInstance for handling the stream
   */
  startDecompress(
    method: CompressionMethod,
    binary?: boolean,
    maxResultSize?: number
  ): Promise<DecompressionInstance>;

  /**
   * Compresses data using the specified compression method
   *
   * @param data - The data to compress as string or Uint8Array
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string or Uint8Array
   */
  compress(
    data: string | Uint8Array,
    method: CompressionMethod
  ): Promise<string | Uint8Array>;

  /**
   * Decompresses data using the specified compression method
   *
   * @param data - The compressed data as string or Uint8Array
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @returns Promise resolving to decompressed data as string or Uint8Array (if binary)
   * @throws Error if input type doesn't match binary flag (string for non-binary, Uint8Array for binary)
   */
  decompress(
    data: string | Uint8Array,
    method: CompressionMethod,
    binary?: boolean
  ): Promise<string | Uint8Array>;

  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[];
}