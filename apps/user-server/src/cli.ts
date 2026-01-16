#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { createServer } from './server';
import { Database } from './database';
import { Logger, LogLevel } from './logger';
import { AppError } from './errors';

const program = new Command();

program
  .name('user-server')
  .description('AI assistant proxy server with user management and billing')
  .version('1.0.0');

program
  .command('server')
  .description('Start the proxy server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-h, --host <host>', 'Host to bind to', 'localhost')
  .option('-d, --database <path>', 'Database file path', './keepai.db')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    // Initialize logger
    const logLevel = options.verbose ? LogLevel.DEBUG : LogLevel.INFO;
    const logger = Logger.getInstance(logLevel);

    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      console.error('ERROR: OPENROUTER_API_KEY environment variable is required');
      process.exit(1);
    }

    logger.info('Initializing User Server...');
    logger.info(`Database: ${options.database}`);
    logger.info(`Server: http://${options.host}:${options.port}`);

    const database = new Database(options.database);
    
    try {
      await database.init();
      logger.info('Database initialized successfully');

      const app = createServer(database, openrouterApiKey);
      
      app.listen(options.port, options.host, () => {
        logger.info(`Server started successfully on http://${options.host}:${options.port}`);
        logger.info('API endpoints:');
        logger.info('  GET  /health                    - Health check');
        logger.info('  GET  /api/v1/user              - User info (requires auth)');
        logger.info('  POST /api/v1/chat/completions   - OpenRouter proxy (requires auth)');
      });

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down server...`);
        try {
          await database.close();
          logger.info('Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', error);
          process.exit(1);
        }
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
      if (error instanceof AppError) {
        logger.error(`Failed to start server: ${error.message}`);
      } else {
        logger.error('Failed to start server', error);
      }
      process.exit(1);
    }
  });

program
  .command('create-user')
  .description('Create a new user (for testing/admin)')
  .option('-a, --auth-id <id>', 'External auth provider ID', 'test-user')
  .option('-b, --balance <amount>', 'Initial balance in microdollars', '10000000')
  .option('-d, --database <path>', 'Database file path', './keepai.db')
  .action(async (options) => {
    const database = new Database(options.database);
    
    try {
      await database.init();
      const user = await database.createUser(options.authId, parseInt(options.balance));
      console.log('User created successfully:');
      console.log(`  ID: ${user.id}`);
      console.log(`  Auth ID: ${user.auth_user_id}`);
      console.log(`  Balance: ${user.balance} microdollars ($${user.balance / 1000000})`);
      
      // Create an API key for the user
      const crypto = require('crypto');
      const apiKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      await database.createApiKeyDirect(user.id, keyHash, 'Default Key');
      
      console.log(`  API Key: ${apiKey}`);
      
    } catch (error) {
      console.error('Failed to create user:', error);
      process.exit(1);
    } finally {
      await database.close();
    }
  });

program
  .command('list-users')
  .description('List all users (for testing/admin)')
  .option('-d, --database <path>', 'Database file path', './keepai.db')
  .action(async (options) => {
    const database = new Database(options.database);
    
    try {
      await database.init();
      
      const users = await database.getAllUsers();
      
      if (users.length === 0) {
        console.log('No users found');
        return;
      }
      
      console.log('Users:');
      console.log('ID\t\t\tAuth ID\t\tBalance\t\tCreated');
      console.log('-'.repeat(80));
      
      for (const user of users) {
        console.log(`${user.id}\t${user.auth_user_id}\t${user.balance}\t\t${new Date(user.created_at).toLocaleString()}`);
      }
      
    } catch (error) {
      console.error('Failed to list users:', error);
      process.exit(1);
    } finally {
      await database.close();
    }
  });

program.parse();
