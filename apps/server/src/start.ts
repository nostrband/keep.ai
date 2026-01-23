import { createServer } from './server.js';
import path from 'path';

const start = async () => {
  try {
    // For CommonJS compatibility when run directly
    const __dirname = process.cwd();
    
    const server = await createServer({
      serveStaticFiles: true,
      staticFilesRoot: path.join(__dirname, "public")
    });
    
    await server.listen();
  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
};

start();