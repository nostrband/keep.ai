import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Gets the current user's pubkey from ~/.keep.ai/current_user.txt
 * @param homePath - Optional home path, defaults to ~/.keep.ai
 * @returns Promise that resolves to the current user's pubkey
 * @throws Error if current_user.txt is not found or empty
 */
export async function getCurrentUser(homePath?: string): Promise<string> {
  const keepAiDir = homePath || path.join(os.homedir(), '.keep.ai');
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
export function getDBPath(pubkey: string, homePath?: string): string {
  const keepAiDir = homePath || path.join(os.homedir(), '.keep.ai');
  
  // Create user directory if it doesn't exist
  const userDir = path.join(keepAiDir, pubkey);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
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