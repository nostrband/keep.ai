import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

interface User {
  key: string;
  pubkey: string;
}

interface UsersFile {
  users: User[];
}

/**
 * Gets the Keep.ai directory path
 * @param homePath - Optional home path, defaults to os.homedir()
 * @returns The path to the .keep.ai directory
 */
export function getKeepaiDir(homePath?: string): string {
  const homeDir = homePath || os.homedir();
  return path.join(homeDir, '.keep.ai');
}

/**
 * Gets the current user's pubkey from ~/.keep.ai/current_user.txt
 * @param homePath - Optional home path, defaults to ~/.keep.ai
 * @returns Promise that resolves to the current user's pubkey
 * @throws Error if current_user.txt is not found or empty
 */
export async function getCurrentUser(homePath?: string): Promise<string> {
  const keepAiDir = getKeepaiDir(homePath);
  const currentUserFile = path.join(keepAiDir, 'current_user.txt');
  
  // Check if current_user.txt exists
  if (!fs.existsSync(currentUserFile)) {
    throw new Error(`Current user file not found: ${currentUserFile}`);
  }
  
  // Read the pubkey from current_user.txt
  const pubkey = fs.readFileSync(currentUserFile, 'utf8').trim();
  
  // Check if pubkey is empty
  if (!pubkey) {
    throw new Error(`Current user file is empty: ${currentUserFile}`);
  }
  
  return pubkey;
}

/**
 * Gets the database path for a specific user pubkey
 * @param pubkey - The user's public key
 * @param homePath - Optional home path, defaults to ~/.keep.ai
 * @returns The path to the user's database file
 */
export function getUserPath(pubkey: string, homePath?: string): string {
  const keepAiDir = getKeepaiDir(homePath);
  
  // Create user directory if it doesn't exist
  // Use recursive: true to handle existing directories gracefully (no TOCTOU race)
  const userDir = path.join(keepAiDir, pubkey);
  fs.mkdirSync(userDir, { recursive: true });

  return userDir;
}

/**
 * Gets the database path for a specific user pubkey
 * @param pubkey - The user's public key
 * @param homePath - Optional home path, defaults to ~/.keep.ai
 * @returns The path to the user's database file
 */
export function getDBPath(pubkey: string, homePath?: string): string {

  // User's sub dir
  const userDir = getUserPath(pubkey, homePath);
  
  // Return the path to the user's database file
  return path.join(userDir, 'data.db');
}

/**
 * Gets the database path for the current user (convenience function)
 * @param homePath - Optional home path, defaults to ~/.keep.ai
 * @returns Promise that resolves to the path to the current user's database file
 * @throws Error if current_user.txt is not found or empty
 */
export async function getCurrentUserDBPath(homePath?: string): Promise<string> {
  const pubkey = await getCurrentUser(homePath);
  return getDBPath(pubkey, homePath);
}

/**
 * Ensures the Keep.ai environment is properly initialized
 * Creates directories, generates user keys, and sets up configuration if needed
 * @param homePath - Optional home path, defaults to os.homedir()
 * @returns Promise that resolves when environment is ready
 */
export async function ensureEnv(homePath?: string): Promise<void> {
  const keepAiDir = getKeepaiDir(homePath);
  const currentUserFile = path.join(keepAiDir, 'current_user.txt');
  
  // Ensure ~/.keep.ai directory exists
  // Use recursive: true to handle existing directories gracefully (no TOCTOU race)
  fs.mkdirSync(keepAiDir, { recursive: true });
  
  // Check if current_user.txt exists
  if (!fs.existsSync(currentUserFile)) {
    // Generate secret key and derive public key
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    
    // Convert keys to hex format
    const secretKeyHex = bytesToHex(secretKey);
    const publicKeyHex = publicKey; // getPublicKey already returns hex string
    
    // Write public key to current_user.txt
    fs.writeFileSync(currentUserFile, publicKeyHex, 'utf8');
    
    // Create user directory
    // Use recursive: true to handle existing directories gracefully (no TOCTOU race)
    const userDir = path.join(keepAiDir, publicKeyHex);
    fs.mkdirSync(userDir, { recursive: true });
    
    // Handle users.json file
    const usersFile = path.join(keepAiDir, 'users.json');
    let usersData: UsersFile = { users: [] };
    
    // Read existing users.json if it exists
    if (fs.existsSync(usersFile)) {
      try {
        const existingData = fs.readFileSync(usersFile, 'utf8');
        usersData = JSON.parse(existingData);
      } catch (error) {
        // If parsing fails, start with empty users array
        usersData = { users: [] };
      }
    }
    
    // Check if user already exists (unlikely but safe to check)
    const existingUser = usersData.users.find(user => user.pubkey === publicKeyHex);
    if (!existingUser) {
      // Add new user to the list
      const newUser: User = {
        key: secretKeyHex,
        pubkey: publicKeyHex
      };
      
      usersData.users.push(newUser);
      
      // Write updated users.json with restrictive permissions (0600)
      // Secret keys should only be readable by the owner
      fs.writeFileSync(usersFile, JSON.stringify(usersData, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
  }
}

