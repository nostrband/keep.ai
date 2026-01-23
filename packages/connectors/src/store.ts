/**
 * File-based credential storage.
 *
 * Stores OAuth credentials as JSON files with restricted permissions (0o600).
 * Path pattern: {basePath}/connectors/{service}/{accountId}.json
 *
 * Credentials (sensitive) are stored in files, while connection metadata
 * (non-sensitive) is stored in the database and syncs across clients.
 */

import createDebug from "debug";
import * as fs from "fs/promises";
import * as path from "path";
import type { ConnectionId, OAuthCredentials } from "./types";

const debug = createDebug("keep:connectors:store");

export class CredentialStore {
  private connectorsDir: string;

  constructor(private basePath: string) {
    this.connectorsDir = path.join(basePath, "connectors");
  }

  /**
   * Get the file path for a connection's credentials.
   */
  private getFilePath(id: ConnectionId): string {
    // Sanitize accountId to be safe for file names
    const safeAccountId = encodeURIComponent(id.accountId).replace(/%/g, "_");
    return path.join(this.connectorsDir, id.service, `${safeAccountId}.json`);
  }

  /**
   * Get the service directory path.
   */
  private getServiceDir(service: string): string {
    return path.join(this.connectorsDir, service);
  }

  /**
   * Ensure the service directory exists.
   */
  private async ensureServiceDir(service: string): Promise<void> {
    const dir = this.getServiceDir(service);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Save credentials for a connection.
   * Creates the directory structure if it doesn't exist.
   * Uses mode 0o600 for file security.
   */
  async save(id: ConnectionId, credentials: OAuthCredentials): Promise<void> {
    await this.ensureServiceDir(id.service);
    const filePath = this.getFilePath(id);

    debug("Saving credentials for %s:%s", id.service, id.accountId);

    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
      encoding: "utf-8",
    });

    debug("Credentials saved to %s", filePath);
  }

  /**
   * Load credentials for a connection.
   * Returns null if the file doesn't exist.
   */
  async load(id: ConnectionId): Promise<OAuthCredentials | null> {
    const filePath = this.getFilePath(id);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      debug("Loaded credentials for %s:%s", id.service, id.accountId);
      return JSON.parse(data) as OAuthCredentials;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        debug("No credentials found for %s:%s", id.service, id.accountId);
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete credentials for a connection.
   * No-op if the file doesn't exist.
   */
  async delete(id: ConnectionId): Promise<void> {
    const filePath = this.getFilePath(id);

    try {
      await fs.unlink(filePath);
      debug("Deleted credentials for %s:%s", id.service, id.accountId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // File didn't exist, that's fine
    }
  }

  /**
   * Check if credentials exist for a connection.
   */
  async exists(id: ConnectionId): Promise<boolean> {
    const filePath = this.getFilePath(id);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all connections for a specific service.
   */
  async listByService(service: string): Promise<ConnectionId[]> {
    const dir = this.getServiceDir(service);

    try {
      const files = await fs.readdir(dir);
      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({
          service,
          // Decode the accountId from the filename
          accountId: decodeURIComponent(
            file.slice(0, -5).replace(/_/g, "%")
          ),
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * List all connections across all services.
   */
  async listAll(): Promise<ConnectionId[]> {
    try {
      const services = await fs.readdir(this.connectorsDir);
      const results: ConnectionId[] = [];

      for (const service of services) {
        const servicePath = path.join(this.connectorsDir, service);
        const stat = await fs.stat(servicePath);
        if (stat.isDirectory()) {
          const connections = await this.listByService(service);
          results.push(...connections);
        }
      }

      return results;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
