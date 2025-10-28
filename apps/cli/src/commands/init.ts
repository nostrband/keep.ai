import { Command } from 'commander';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import debug from 'debug';

const debugInit = debug('cli:init');

interface User {
  key: string;
  pubkey: string;
}

interface UsersFile {
  users: User[];
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new user with generated keys')
    .action(async () => {
      await runInitCommand();
    });
}

async function runInitCommand(): Promise<void> {
  try {
    // Generate secret key and derive public key
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    
    // Convert keys to hex format
    const secretKeyHex = bytesToHex(secretKey);
    const publicKeyHex = publicKey; // getPublicKey already returns hex string
    
    debugInit('Generated keys:', { publicKey: publicKeyHex });
    
    // Ensure ~/.keep.ai directory exists
    const keepAiDir = path.join(os.homedir(), '.keep.ai');
    if (!fs.existsSync(keepAiDir)) {
      fs.mkdirSync(keepAiDir, { recursive: true });
      debugInit('Created directory:', keepAiDir);
    }
    
    // Write public key to current_user.txt
    const currentUserFile = path.join(keepAiDir, 'current_user.txt');
    fs.writeFileSync(currentUserFile, publicKeyHex, 'utf8');
    debugInit('Written current user to:', currentUserFile);
    
    // Create user directory
    const userDir = path.join(keepAiDir, publicKeyHex);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      debugInit('Created user directory:', userDir);
    }
    
    // Handle users.json file
    const usersFile = path.join(keepAiDir, 'users.json');
    let usersData: UsersFile = { users: [] };
    
    // Read existing users.json if it exists
    if (fs.existsSync(usersFile)) {
      try {
        const existingData = fs.readFileSync(usersFile, 'utf8');
        usersData = JSON.parse(existingData);
        debugInit('Loaded existing users.json');
      } catch (error) {
        debugInit('Error reading users.json, creating new:', error);
        usersData = { users: [] };
      }
    }
    
    // Check if user already exists
    const existingUser = usersData.users.find(user => user.pubkey === publicKeyHex);
    if (existingUser) {
      console.log(`User with public key ${publicKeyHex} already exists.`);
      console.log('Current user has been set to this existing user.');
      return;
    }
    
    // Add new user to the list
    const newUser: User = {
      key: secretKeyHex,
      pubkey: publicKeyHex
    };
    
    usersData.users.push(newUser);
    
    // Write updated users.json
    fs.writeFileSync(usersFile, JSON.stringify(usersData, null, 2), 'utf8');
    debugInit('Updated users.json with new user');
    
    console.log('✅ User initialization completed successfully!');
    console.log(`📋 Public Key: ${publicKeyHex}`);
    console.log(`📁 User Directory: ${userDir}`);
    console.log(`👤 Current User: ${currentUserFile}`);
    console.log(`📝 Users Database: ${usersFile}`);
    
  } catch (error) {
    console.error('❌ Failed to initialize user:', error);
    process.exit(1);
  }
}