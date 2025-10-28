import { Command } from 'commander';
import { createDBNode, getCurrentUser, getDBPath } from '@app/node';
import { KeepDb, KeepDbApi } from '@app/db';
import { AssistantUIMessage } from '@app/proto';
;
import * as readline from 'readline';
import debug from 'debug';

const debugChat = debug('cli:chat');

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Start interactive chat with AI assistant')
    .action(async () => {
      await runChatCommand();
    });
}

// Helper function to print messages - removes code duplication
function printMessage(msg: AssistantUIMessage): void {
  const role = msg.role === 'user' ? 'You > ' : 'Assistant > ';
  const textPart = msg.parts.find(part => part.type === 'text');
  const text = textPart && 'text' in textPart ? textPart.text : '';
  console.log(`${role}${text}`);
}

async function runChatCommand(): Promise<void> {
  try {
    // Get database path based on current user
    const pubkey = await getCurrentUser();
    const dbPath = getDBPath(pubkey);
    debugChat('Connecting to database:', dbPath);
    
    const dbInterface = await createDBNode(dbPath);
    const keepDB = new KeepDb(dbInterface);
    
    // Initialize database
    await keepDB.start();
    debugChat('Database initialized');

    // Create store instances
    const userId = 'cli-user';
    const api = new KeepDbApi(keepDB, userId);

    // Print invitation and recent messages
    console.log('\n🤖 Welcome to Keep AI Assistant!');
    console.log('Type your message and press Enter. Type "exit" to quit.\n');

    // Get and display 5 latest messages from 'main' chat
    let lastMessageTimestamp: string | undefined;
    try {
      const messages = await api.memoryStore.getMessages({
        threadId: 'main',
        limit: 5
      });
      
      if (messages.length > 0) {
        console.log('Recent messages:');
        messages.forEach(printMessage);
        console.log('');
        
        // Set initial timestamp from the last message
        const lastMessage = messages[messages.length - 1];
        lastMessageTimestamp = lastMessage.metadata?.createdAt;
      }
    } catch (error) {
      debugChat('No previous messages found or error loading them:', error);
    }

    // Setup readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Flag to control the loops
    let shouldExit = false;

    // Input loop - handles user input and creates message tasks
    const inputLoop = async (): Promise<void> => {
      const askQuestion = (): Promise<string> => {
        return new Promise((resolve) => {
          rl.question('You > ', (answer) => {
            resolve(answer.trim());
          });
        });
      };

      while (!shouldExit) {
        try {
          const userInput = await askQuestion();
          
          if (userInput.toLowerCase() === 'exit') {
            console.log('Goodbye! 👋');
            shouldExit = true;
            break;
          }

          if (userInput === '') {
            continue;
          }

          console.log('Processing your message...');
          
          // Create user message
          const userMessage = await api.addMessage({
            threadId: 'main',
            content: userInput
          })

          // Update last message timestamp
          lastMessageTimestamp = userMessage.metadata?.createdAt;
          
        } catch (error) {
          console.error('Error processing message:', error);
        }
      }
    };

    // Message monitoring loop - watches for new messages and prints them
    const messageMonitorLoop = async (): Promise<void> => {
      const checkInterval = 1000; // Check every second

      while (!shouldExit) {
        try {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          
          if (shouldExit) break;

          // Get new messages since the last timestamp
          const newMessages = await api.memoryStore.getMessages({
            threadId: 'main',
            since: lastMessageTimestamp
          });

          if (newMessages.length > 0) {
            console.log(''); // Empty line for spacing
            
            // Print new messages
            newMessages.forEach(printMessage);
            
            console.log(''); // Empty line for spacing
            
            // Update last message timestamp to the newest message
            const lastMessage = newMessages[newMessages.length - 1];
            lastMessageTimestamp = lastMessage.metadata?.createdAt;
          }
          
        } catch (error) {
          debugChat('Error checking for new messages:', error);
        }
      }
    };

    // Start both loops concurrently
    await Promise.race([
      inputLoop(),
      messageMonitorLoop()
    ]);

    // Cleanup
    rl.close();
    await dbInterface.close();
    debugChat('Chat session ended');

  } catch (error) {
    console.error('Failed to start chat:', error);
    process.exit(1);
  }
}