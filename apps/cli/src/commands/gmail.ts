import { Command } from 'commander';
import { google } from 'googleapis';
import fs from 'fs/promises';
import http from 'http';
import url from 'url';
import debug from 'debug';

const debugGmail = debug('cli:gmail');

const CLIENT_ID = "642393276548-lfrhhkuf7nfuo6o3542tmibj8306a17m.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.GMAIL_SECRET;
const PORT = 4681;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;

const TOKEN_PATH = "gmail-token.json";

export function registerGmailCommand(program: Command): void {
  program
    .command('gmail')
    .description('Gmail integration for testing OAuth and API access')
    .action(async () => {
      await runGmailCommand();
    });
}

async function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  try {
    const tokenStr = await fs.readFile(TOKEN_PATH, "utf8");
    const tokens = JSON.parse(tokenStr);
    oAuth2Client.setCredentials(tokens);
    debugGmail('Loaded existing tokens from file');
    return oAuth2Client;
  } catch (error) {
    debugGmail('No token file found, starting OAuth flow');
    
    // No token yet → do first-time login
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.modify"],
      prompt: "consent",
    });

    console.log("Authorize this app by visiting this URL:", authUrl);
    console.log("Starting local server to receive authorization code...");

    const code = await waitForCode();
    debugGmail('Received authorization code');

    const { tokens } = await oAuth2Client.getToken(code);
    
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    console.log(`Tokens saved to ${TOKEN_PATH}`);
    
    oAuth2Client.setCredentials(tokens);
    return oAuth2Client;
  }
}

async function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);
      
      if (parsedUrl.pathname === '/oauth/callback') {
        const code = parsedUrl.query.code as string;
        
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);
          
          server.close();
          debugGmail('OAuth callback received, code extracted');
          resolve(code);
        } else {
          const error = parsedUrl.query.error as string;
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization Failed</h1>
                <p>Error: ${error || 'Unknown error'}</p>
              </body>
            </html>
          `);
          
          server.close();
          reject(new Error(`Authorization failed: ${error || 'Unknown error'}`));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Local server running on http://127.0.0.1:${PORT}`);
      console.log('Waiting for authorization...');
    });

    server.on('error', (error) => {
      reject(new Error(`Server error: ${error.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout - no response received within 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

async function backgroundJob() {
  try {
    console.log('Initializing Gmail OAuth client...');
    const auth = await getOAuthClient();
    
    console.log('Creating Gmail API client...');
    const gmail = google.gmail({ version: "v1", auth });

    console.log('Fetching latest messages...');
    const res = await gmail.users.messages.list({ 
      userId: "me", 
      maxResults: 10 
    });

    if (res.data.messages && res.data.messages.length > 0) {
      console.log(`Found ${res.data.messages.length} messages:`);
      
      // Get details for each message
      for (const message of res.data.messages.slice(0, 5)) {
        if (message.id) {
          const messageDetail = await gmail.users.messages.get({ 
            userId: "me", 
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });

          const headers = messageDetail.data.payload?.headers || [];
          const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No subject';
          const date = headers.find((h: any) => h.name === 'Date')?.value || 'Unknown date';
          
          console.log(`\n📧 Message ID: ${message.id}`);
          console.log(`   From: ${from}`);
          console.log(`   Subject: ${subject}`);
          console.log(`   Date: ${date}`);
        }
      }
    } else {
      console.log('No messages found.');
    }

    console.log('\n✅ Gmail integration test completed successfully!');
  } catch (error) {
    console.error('❌ Gmail integration failed:', error);
    throw error;
  }
}

async function runGmailCommand(): Promise<void> {
  try {
    console.log('\n🔧 Testing Gmail integration...\n');
    await backgroundJob();
  } catch (error) {
    console.error('Failed to run Gmail command:', error);
    process.exit(1);
  }
}