/**
 * Default implementation of StreamFactory
 */

import { SimplePool } from "nostr-tools";
import { StreamFactory, StreamWriterInterface } from "./interfaces";
import { StreamReader } from "./StreamReader";
import { StreamWriter } from "./StreamWriter";
import { StreamMetadata, StreamReaderConfig, StreamWriterConfig } from "./types";
import { Compression } from "../../compression";

/**
 * Default implementation of StreamFactory
 * Uses the built-in StreamReader and StreamWriter classes
 */
export class DefaultStreamFactory implements StreamFactory {

  #readerConfig?: StreamReaderConfig;
  #writerConfig?: StreamWriterConfig;
  #compression?: Compression;

  get readerConfig() {
    return this.#readerConfig;
  }

  set readerConfig(c: StreamReaderConfig | undefined) {
    this.#readerConfig = c;
  }

  get writerConfig() {
    return this.#writerConfig;
  }

  set writerConfig(c: StreamWriterConfig | undefined) {
    this.#writerConfig = c;
  }

  get compression(): Compression | undefined {
    return this.#compression;
  }

  set compression(c: Compression | undefined) {
    this.#compression = c;
  }

  /**
   * Creates a StreamReader for reading from a stream
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param config - Configuration options
   * @returns Promise resolving to an AsyncIterable of string or Uint8Array
   */
  async createReader(
    metadata: StreamMetadata,
    pool: SimplePool,
    config?: StreamReaderConfig
  ): Promise<AsyncIterable<string | Uint8Array>> {
    if (!this.#compression) {
      throw new Error('Compression implementation is required for createReader');
    }
    return new StreamReader(metadata, pool, config || this.#readerConfig, this.#compression);
  }

  /**
   * Creates a StreamWriter for writing to a stream
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param senderPrivkey - Private key for signing stream events
   * @param config - Configuration options
   * @returns Promise resolving to a StreamWriterInterface
   */
  async createWriter(
    metadata: StreamMetadata,
    pool: SimplePool,
    senderPrivkey: Uint8Array,
    config?: StreamWriterConfig
  ): Promise<StreamWriterInterface> {
    if (!this.#compression) {
      throw new Error('Compression implementation is required for createWriter');
    }
    return new StreamWriter(metadata, pool, senderPrivkey, config || this.#writerConfig, this.#compression);
  }
}

/**
 * Singleton instance of DefaultStreamFactory
 */
let defaultStreamFactory: StreamFactory | null = null;

/**
 * Gets the default StreamFactory instance
 * 
 * @returns The default StreamFactory instance
 */
export function getStreamFactory(): StreamFactory {
  if (!defaultStreamFactory) {
    defaultStreamFactory = new DefaultStreamFactory();
  }
  return defaultStreamFactory;
}