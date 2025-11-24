#!/usr/bin/env node

import { Command } from 'commander';
import { registerChatCommand } from './commands/chat';
import { registerWorkerCommand } from './commands/worker';
import { registerInitCommand } from './commands/init';
import { registerSandboxCommand } from './commands/sandbox';
import { registerVacuumCommand } from './commands/vacuum';
import { KEEPAI_DIR } from './const';
import { Env, setEnv } from '@app/agent';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import debug from 'debug';
import { registerAgentCommand } from './commands/agent';

const debugCli = debug('cli:index');

// Setup environment variables before initializing commands
function setupEnvironment(): void {
  try {
    // Ensure ~/.keep.ai directory exists
    const keepAiDir = path.join(os.homedir(), KEEPAI_DIR);
    if (!fs.existsSync(keepAiDir)) {
      fs.mkdirSync(keepAiDir, { recursive: true });
      debugCli('Created directory:', keepAiDir);
    }

    // Load environment variables from ~/.keep.ai/.env
    const envPath = path.join(keepAiDir, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      debugCli('Loaded environment variables from:', envPath);
    } else {
      debugCli('No .env file found at:', envPath);
    }

    // Set up environment variables for the agent
    const env: Env = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
      AGENT_MODEL: process.env.AGENT_MODEL,
      EXA_API_KEY: process.env.EXA_API_KEY,
    };
    
    setEnv(env);
    debugCli('Environment variables set for agent');
  } catch (error) {
    debugCli('Error setting up environment:', error);
  }
}

// Setup environment before initializing CLI
setupEnvironment();

const program = new Command();

program
  .name('keepai')
  .description('CLI for Keep AI assistant')
  .version('0.1.0');

// Register all commands
registerInitCommand(program);
registerChatCommand(program);
registerWorkerCommand(program);
registerSandboxCommand(program);
registerAgentCommand(program);
registerVacuumCommand(program);

// Parse command line arguments
program.parse(process.argv);