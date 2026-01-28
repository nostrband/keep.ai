import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getKeepaiDir,
  getCurrentUser,
  getUserPath,
  getDBPath,
  getCurrentUserDBPath,
  ensureEnv,
} from "@app/node";

/**
 * Tests for getDBPath.ts - Path/environment management and initialization
 *
 * Why these tests matter:
 * - getDBPath is foundational infrastructure for database path resolution
 * - ensureEnv handles critical first-time setup including key generation
 * - Errors here would corrupt user data or prevent application startup
 */

describe("getDBPath", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "keepai-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getKeepaiDir", () => {
    it("should return default .keep.ai directory when no homePath provided", () => {
      const result = getKeepaiDir();
      expect(result).toBe(path.join(os.homedir(), ".keep.ai"));
    });

    it("should use provided homePath", () => {
      const result = getKeepaiDir(tempDir);
      expect(result).toBe(path.join(tempDir, ".keep.ai"));
    });

    it("should handle paths with spaces", () => {
      const pathWithSpaces = path.join(tempDir, "path with spaces");
      fs.mkdirSync(pathWithSpaces, { recursive: true });
      const result = getKeepaiDir(pathWithSpaces);
      expect(result).toBe(path.join(pathWithSpaces, ".keep.ai"));
    });

    it("should handle trailing slashes in homePath", () => {
      const pathWithSlash = tempDir + path.sep;
      const result = getKeepaiDir(pathWithSlash);
      expect(result).toBe(path.join(tempDir, ".keep.ai"));
    });
  });

  describe("getCurrentUser", () => {
    it("should throw error when current_user.txt does not exist", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });

      await expect(getCurrentUser(tempDir)).rejects.toThrow(
        /Current user file not found/
      );
    });

    it("should throw error when current_user.txt is empty", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      fs.writeFileSync(path.join(keepaiDir, "current_user.txt"), "");

      await expect(getCurrentUser(tempDir)).rejects.toThrow(
        /Current user file is empty/
      );
    });

    it("should throw error when current_user.txt contains only whitespace", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      fs.writeFileSync(path.join(keepaiDir, "current_user.txt"), "   \n\t  ");

      await expect(getCurrentUser(tempDir)).rejects.toThrow(
        /Current user file is empty/
      );
    });

    it("should return trimmed pubkey from current_user.txt", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      const testPubkey = "abc123def456";
      fs.writeFileSync(
        path.join(keepaiDir, "current_user.txt"),
        `  ${testPubkey}  \n`
      );

      const result = await getCurrentUser(tempDir);
      expect(result).toBe(testPubkey);
    });

    it("should handle hex-encoded pubkey format", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      // 64-character hex string (32 bytes as hex)
      const testPubkey = "a".repeat(64);
      fs.writeFileSync(path.join(keepaiDir, "current_user.txt"), testPubkey);

      const result = await getCurrentUser(tempDir);
      expect(result).toBe(testPubkey);
      expect(result.length).toBe(64);
    });
  });

  describe("getUserPath", () => {
    it("should create user directory if it does not exist", () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      const pubkey = "testpubkey123";

      const result = getUserPath(pubkey, tempDir);

      expect(result).toBe(path.join(keepaiDir, pubkey));
      expect(fs.existsSync(result)).toBe(true);
    });

    it("should return existing user directory without error", () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      const pubkey = "existinguser456";
      const userDir = path.join(keepaiDir, pubkey);
      fs.mkdirSync(userDir, { recursive: true });

      const result = getUserPath(pubkey, tempDir);

      expect(result).toBe(userDir);
      expect(fs.existsSync(result)).toBe(true);
    });

    it("should handle pubkeys with special characters", () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      // Hex pubkeys should only have 0-9a-f but test robustness
      const pubkey = "0123456789abcdef";

      const result = getUserPath(pubkey, tempDir);

      expect(result).toBe(path.join(keepaiDir, pubkey));
      expect(fs.existsSync(result)).toBe(true);
    });
  });

  describe("getDBPath", () => {
    it("should return path to data.db in user directory", () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      const pubkey = "dbpathtest123";

      const result = getDBPath(pubkey, tempDir);

      expect(result).toBe(path.join(keepaiDir, pubkey, "data.db"));
    });

    it("should create user directory as side effect", () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      const pubkey = "newuser789";

      getDBPath(pubkey, tempDir);

      expect(fs.existsSync(path.join(keepaiDir, pubkey))).toBe(true);
    });
  });

  describe("getCurrentUserDBPath", () => {
    it("should return DB path for current user", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      const pubkey = "currentuser123";
      fs.mkdirSync(keepaiDir, { recursive: true });
      fs.writeFileSync(path.join(keepaiDir, "current_user.txt"), pubkey);

      const result = await getCurrentUserDBPath(tempDir);

      expect(result).toBe(path.join(keepaiDir, pubkey, "data.db"));
    });

    it("should throw when no current user exists", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });

      await expect(getCurrentUserDBPath(tempDir)).rejects.toThrow(
        /Current user file not found/
      );
    });
  });

  describe("ensureEnv", () => {
    it("should create .keep.ai directory if it does not exist", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      expect(fs.existsSync(keepaiDir)).toBe(false);

      await ensureEnv(tempDir);

      expect(fs.existsSync(keepaiDir)).toBe(true);
    });

    it("should generate keys and create current_user.txt", async () => {
      await ensureEnv(tempDir);

      const keepaiDir = path.join(tempDir, ".keep.ai");
      const currentUserFile = path.join(keepaiDir, "current_user.txt");

      expect(fs.existsSync(currentUserFile)).toBe(true);

      const pubkey = fs.readFileSync(currentUserFile, "utf8").trim();
      expect(pubkey.length).toBe(64); // Hex-encoded 32-byte pubkey
      expect(/^[0-9a-f]+$/.test(pubkey)).toBe(true);
    });

    it("should create user directory for generated pubkey", async () => {
      await ensureEnv(tempDir);

      const keepaiDir = path.join(tempDir, ".keep.ai");
      const pubkey = fs.readFileSync(
        path.join(keepaiDir, "current_user.txt"),
        "utf8"
      ).trim();
      const userDir = path.join(keepaiDir, pubkey);

      expect(fs.existsSync(userDir)).toBe(true);
    });

    it("should create users.json with generated user", async () => {
      await ensureEnv(tempDir);

      const keepaiDir = path.join(tempDir, ".keep.ai");
      const usersFile = path.join(keepaiDir, "users.json");

      expect(fs.existsSync(usersFile)).toBe(true);

      const usersData = JSON.parse(fs.readFileSync(usersFile, "utf8"));
      expect(usersData.users).toHaveLength(1);
      expect(usersData.users[0].pubkey.length).toBe(64);
      expect(usersData.users[0].key.length).toBe(64); // Secret key is also 64 hex chars
    });

    it("should not overwrite existing current_user.txt", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });
      const existingPubkey = "existingpubkey" + "0".repeat(50);
      fs.writeFileSync(path.join(keepaiDir, "current_user.txt"), existingPubkey);

      await ensureEnv(tempDir);

      const pubkey = fs.readFileSync(
        path.join(keepaiDir, "current_user.txt"),
        "utf8"
      ).trim();
      expect(pubkey).toBe(existingPubkey);
    });

    it("should append to existing users.json without duplicates", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });

      // Create initial users.json with one user
      const existingUser = {
        key: "a".repeat(64),
        pubkey: "b".repeat(64),
      };
      fs.writeFileSync(
        path.join(keepaiDir, "users.json"),
        JSON.stringify({ users: [existingUser] }, null, 2)
      );

      await ensureEnv(tempDir);

      // Should have added a new user (since current_user.txt didn't exist)
      const usersData = JSON.parse(
        fs.readFileSync(path.join(keepaiDir, "users.json"), "utf8")
      );
      expect(usersData.users).toHaveLength(2);
      expect(usersData.users[0]).toEqual(existingUser);
    });

    it("should handle corrupted users.json gracefully", async () => {
      const keepaiDir = path.join(tempDir, ".keep.ai");
      fs.mkdirSync(keepaiDir, { recursive: true });

      // Write invalid JSON
      fs.writeFileSync(path.join(keepaiDir, "users.json"), "not valid json{");

      await ensureEnv(tempDir);

      // Should have created valid users.json with new user
      const usersData = JSON.parse(
        fs.readFileSync(path.join(keepaiDir, "users.json"), "utf8")
      );
      expect(usersData.users).toHaveLength(1);
    });

    it("should be idempotent - running twice produces same result", async () => {
      await ensureEnv(tempDir);

      const keepaiDir = path.join(tempDir, ".keep.ai");
      const firstPubkey = fs.readFileSync(
        path.join(keepaiDir, "current_user.txt"),
        "utf8"
      ).trim();
      const firstUsersData = JSON.parse(
        fs.readFileSync(path.join(keepaiDir, "users.json"), "utf8")
      );

      await ensureEnv(tempDir);

      const secondPubkey = fs.readFileSync(
        path.join(keepaiDir, "current_user.txt"),
        "utf8"
      ).trim();
      const secondUsersData = JSON.parse(
        fs.readFileSync(path.join(keepaiDir, "users.json"), "utf8")
      );

      expect(secondPubkey).toBe(firstPubkey);
      expect(secondUsersData).toEqual(firstUsersData);
    });

    it("should generate unique keys each time for new users", async () => {
      // First environment
      await ensureEnv(tempDir);
      const keepaiDir1 = path.join(tempDir, ".keep.ai");
      const pubkey1 = fs.readFileSync(
        path.join(keepaiDir1, "current_user.txt"),
        "utf8"
      ).trim();

      // Create second temp dir for comparison
      const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "keepai-test2-"));
      try {
        await ensureEnv(tempDir2);
        const keepaiDir2 = path.join(tempDir2, ".keep.ai");
        const pubkey2 = fs.readFileSync(
          path.join(keepaiDir2, "current_user.txt"),
          "utf8"
        ).trim();

        expect(pubkey1).not.toBe(pubkey2);
      } finally {
        fs.rmSync(tempDir2, { recursive: true, force: true });
      }
    });
  });
});
