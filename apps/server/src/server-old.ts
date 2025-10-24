import fastify from "fastify";
import { CRSqliteWorkerFastify, createDBNode } from "@app/node";
import { KeepDb, KeepDbApi } from "@app/db";
import { KeepWorker, setEnv, type Env } from "@app/agent";
import debug from "debug";
import path from "path";
import os from "os";
import fs from "fs";
import dotenv from "dotenv";

const debugServer = debug("server:server");

// Setup configuration directory and environment
const configDir = path.join(os.homedir(), ".keep.ai");
const envPath = path.join(configDir, ".env");
const dbPath = path.join(configDir, "keepai.db");

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Load environment variables from ~/.keep.ai/.env
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Create Env object from environment variables
const env: Env = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  AGENT_MODEL: process.env.AGENT_MODEL,
  EXA_API_KEY: process.env.EXA_API_KEY,
};

// Set environment in agent package
setEnv(env);

// For CommonJS compatibility
const __dirname = process.cwd();

const app = fastify({ logger: true });

// Create database and worker
async function createDbWorker() {
  const dbInstance = await createDBNode(dbPath);
  const keepDB = new KeepDb(dbInstance);
  await keepDB.start();

  const worker = new CRSqliteWorkerFastify(keepDB.db);
  await worker.start();

  return { dbWorker: worker, keepDB };
}

async function createKeepWorker(keepDB: KeepDb) {
  const userId = "cli-user";
  const api = new KeepDbApi(keepDB, userId);

  // Create KeepWorker
  const worker = new KeepWorker({ api });

  // Start worker
  await worker.start();

  return worker;
}

const start = async () => {
  try {
    debugServer("Config directory:", configDir);
    debugServer("Database path:", dbPath);
    debugServer("Environment file:", envPath);

    // Initialize the worker
    const { dbWorker, keepDB } = await createDbWorker();
    const keepWorker = await createKeepWorker(keepDB);

    // Register worker routes under /api/worker prefix
    await app.register(
      async function (fastify) {
        // @ts-ignore
        await dbWorker.registerRoutes(fastify);
      },
      { prefix: "/api/worker" }
    );

    // Serve static files from public directory
    await app.register(require("@fastify/static"), {
      root: path.join(__dirname, "public"),
      prefix: "/",
    });

    // SPA fallback - serve index.html for all non-API routes
    app.setNotFoundHandler((request, reply) => {
      // Don't serve index.html for API routes
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: "API endpoint not found" });
        return;
      }

      // Serve index.html for SPA routes
      // @ts-ignore
      reply.sendFile("index.html");
    });

    // await app.ready();
    await app.listen({
      port: Number(process.env.PORT || 3000),
      host: "0.0.0.0",
    });
    console.log("listening");
    debugServer("Server listening on port", process.env.PORT || 3000);
    debugServer("API available at /api/worker/*");
    debugServer("SPA served from /");
  } catch (err) {
    console.error("error", err);
    app.log.error(err);
    process.exit(1);
  }
};

start();
