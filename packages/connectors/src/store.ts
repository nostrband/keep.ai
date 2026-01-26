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
import { randomUUID } from "crypto";
import type { ConnectionId, OAuthCredentials } from "./types";

const debug = createDebug("keep:connectors:store");

/** Required file permissions for credential files (owner read/write only) */
const CREDENTIAL_FILE_MODE = 0o600;

/** Required directory permissions (owner read/write/execute only) */
const CREDENTIAL_DIR_MODE = 0o700;

export class CredentialStore {
  private connectorsDir: string;

  constructor(private basePath: string) {
    this.connectorsDir = path.join(basePath, "connectors");
  }

  /**
   * Encode account ID for safe filesystem storage using base64url.
   * This encoding is reversible and collision-free.
   */
  private encodeAccountId(accountId: string): string {
    return Buffer.from(accountId, "utf-8")
      .toString("base64url")
      .replace(/=+$/, ""); // Remove padding for cleaner filenames
  }

  /**
   * Decode account ID from base64url filename.
   */
  private decodeAccountId(encoded: string): string {
    // Re-add padding if needed
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    return Buffer.from(padded, "base64url").toString("utf-8");
  }

  /**
   * Legacy encoding for migration support.
   */
  private legacyEncodeAccountId(accountId: string): string {
    return encodeURIComponent(accountId).replace(/%/g, "_");
  }

  /**
   * Validate that a service ID is safe for filesystem use.
   */
  private validateServiceId(service: string): void {
    // Allow only alphanumeric, dash, and underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
      throw new Error(`Invalid service ID: ${service}`);
    }
  }

  /**
   * Get the file path for a connection's credentials.
   * Uses base64url encoding to prevent path traversal and collisions.
   */
  private getFilePath(id: ConnectionId): string {
    this.validateServiceId(id.service);
    const safeAccountId = this.encodeAccountId(id.accountId);
    const filePath = path.join(
      this.connectorsDir,
      id.service,
      `${safeAccountId}.json`
    );

    // Verify path stays within connectors directory (defense in depth)
    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(this.connectorsDir);
    if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    return filePath;
  }

  /**
   * Get legacy file path for migration.
   */
  private getLegacyFilePath(id: ConnectionId): string {
    this.validateServiceId(id.service);
    const safeAccountId = this.legacyEncodeAccountId(id.accountId);
    return path.join(this.connectorsDir, id.service, `${safeAccountId}.json`);
  }

  /**
   * Get the service directory path.
   */
  private getServiceDir(service: string): string {
    this.validateServiceId(service);
    return path.join(this.connectorsDir, service);
  }

  /**
   * Ensure the service directory exists with correct permissions.
   */
  private async ensureServiceDir(service: string): Promise<void> {
    const dir = this.getServiceDir(service);
    await fs.mkdir(dir, { recursive: true, mode: CREDENTIAL_DIR_MODE });

    // Verify and fix directory permissions
    const stat = await fs.stat(dir);
    const currentMode = stat.mode & 0o777;
    if (currentMode !== CREDENTIAL_DIR_MODE) {
      debug(
        "Fixing directory permissions for %s: %o -> %o",
        dir,
        currentMode,
        CREDENTIAL_DIR_MODE
      );
      await fs.chmod(dir, CREDENTIAL_DIR_MODE);
    }
  }

  /**
   * Verify file permissions are correct, fix if needed.
   */
  private async verifyAndFixPermissions(filePath: string): Promise<void> {
    const stat = await fs.stat(filePath);
    const currentMode = stat.mode & 0o777;
    if (currentMode !== CREDENTIAL_FILE_MODE) {
      debug(
        "Fixing file permissions for %s: %o -> %o",
        filePath,
        currentMode,
        CREDENTIAL_FILE_MODE
      );
      await fs.chmod(filePath, CREDENTIAL_FILE_MODE);
    }
  }

  /**
   * Atomic write: write to temp file, then rename.
   * This prevents corruption on crash and ensures correct permissions.
   */
  private async atomicWrite(
    filePath: string,
    content: string
  ): Promise<void> {
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.tmp-${randomUUID()}.json`);

    try {
      // Write to temp file with correct permissions
      await fs.writeFile(tempPath, content, {
        mode: CREDENTIAL_FILE_MODE,
        encoding: "utf-8",
      });

      // Verify permissions on temp file
      await this.verifyAndFixPermissions(tempPath);

      // Atomic rename
      await fs.rename(tempPath, filePath);

      // Verify final permissions (rename should preserve them, but verify)
      await this.verifyAndFixPermissions(filePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Audit and fix permissions on all credential files.
   * Should be called on startup.
   */
  async auditPermissions(): Promise<void> {
    debug("Auditing credential file permissions...");

    try {
      // Check connectors directory
      try {
        const stat = await fs.stat(this.connectorsDir);
        const currentMode = stat.mode & 0o777;
        if (currentMode !== CREDENTIAL_DIR_MODE) {
          debug(
            "Fixing connectors dir permissions: %o -> %o",
            currentMode,
            CREDENTIAL_DIR_MODE
          );
          await fs.chmod(this.connectorsDir, CREDENTIAL_DIR_MODE);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        // Directory doesn't exist yet, that's fine
        return;
      }

      const services = await fs.readdir(this.connectorsDir);
      for (const service of services) {
        const servicePath = path.join(this.connectorsDir, service);
        const stat = await fs.stat(servicePath);

        if (!stat.isDirectory()) continue;

        // Check service directory permissions
        const dirMode = stat.mode & 0o777;
        if (dirMode !== CREDENTIAL_DIR_MODE) {
          debug(
            "Fixing service dir permissions for %s: %o -> %o",
            service,
            dirMode,
            CREDENTIAL_DIR_MODE
          );
          await fs.chmod(servicePath, CREDENTIAL_DIR_MODE);
        }

        // Check each credential file
        const files = await fs.readdir(servicePath);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;

          const filePath = path.join(servicePath, file);
          await this.verifyAndFixPermissions(filePath);
        }
      }

      debug("Permission audit complete");
    } catch (error) {
      debug("Permission audit failed: %s", error);
      throw error;
    }
  }

  /**
   * Save credentials for a connection.
   * Creates the directory structure if it doesn't exist.
   * Uses atomic write with permission verification for security.
   */
  async save(id: ConnectionId, credentials: OAuthCredentials): Promise<void> {
    await this.ensureServiceDir(id.service);
    const filePath = this.getFilePath(id);

    debug("Saving credentials for %s:%s", id.service, id.accountId);

    await this.atomicWrite(filePath, JSON.stringify(credentials, null, 2));

    debug("Credentials saved to %s", filePath);
  }

  /**
   * Load credentials for a connection.
   * Returns null if the file doesn't exist.
   * Automatically migrates from legacy encoding if found.
   */
  async load(id: ConnectionId): Promise<OAuthCredentials | null> {
    const filePath = this.getFilePath(id);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      debug("Loaded credentials for %s:%s", id.service, id.accountId);
      return JSON.parse(data) as OAuthCredentials;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Try legacy path for migration
        const legacyPath = this.getLegacyFilePath(id);
        if (legacyPath !== filePath) {
          try {
            const data = await fs.readFile(legacyPath, "utf-8");
            const credentials = JSON.parse(data) as OAuthCredentials;

            // Migrate to new encoding
            debug(
              "Migrating credentials from legacy path for %s:%s",
              id.service,
              id.accountId
            );
            await this.save(id, credentials);

            // Remove legacy file
            await fs.unlink(legacyPath);

            return credentials;
          } catch (legacyError) {
            if (
              (legacyError as NodeJS.ErrnoException).code !== "ENOENT"
            ) {
              throw legacyError;
            }
          }
        }

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
   * Handles both new base64url and legacy encodings.
   */
  async listByService(service: string): Promise<ConnectionId[]> {
    const dir = this.getServiceDir(service);

    try {
      const files = await fs.readdir(dir);
      const results: ConnectionId[] = [];
      const seen = new Set<string>();

      for (const file of files) {
        if (!file.endsWith(".json") || file.startsWith(".tmp-")) continue;

        const encoded = file.slice(0, -5);
        let accountId: string;

        try {
          // Try new base64url decoding first
          accountId = this.decodeAccountId(encoded);
        } catch {
          // Fall back to legacy decoding
          accountId = decodeURIComponent(encoded.replace(/_/g, "%"));
        }

        // Deduplicate in case both encodings exist for same account
        if (!seen.has(accountId)) {
          seen.add(accountId);
          results.push({ service, accountId });
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
