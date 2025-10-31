import { Command } from "commander";
import { createDBNode, getCurrentUser, getDBPath } from "@app/node";
import { KeepWorker } from "@app/agent";
import debug from "debug";
import { KeepDb, KeepDbApi } from "@app/db";

const debugWorker = debug("cli:worker");

export function registerWorkerCommand(program: Command): void {
  program
    .command("worker")
    .description("Start the Keep AI worker daemon")
    .action(async () => {
      // Set up global error handlers before starting
      setupGlobalErrorHandlers();
      await runWorkerCommand();
    });
}

function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught Exception:", error);
    console.error("Stack trace:", error.stack);
    debugWorker("Uncaught exception:", error);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ Unhandled Promise Rejection at:", promise);
    console.error("Reason:", reason);
    if (reason instanceof Error) {
      console.error("Stack trace:", reason.stack);
    }
    debugWorker("Unhandled rejection:", reason);
    process.exit(1);
  });

  // Handle warnings
  process.on("warning", (warning) => {
    console.warn("⚠️ Warning:", warning.name);
    console.warn("Message:", warning.message);
    if (warning.stack) {
      console.warn("Stack trace:", warning.stack);
    }
    debugWorker("Process warning:", warning);
  });
}

async function runWorkerCommand(): Promise<void> {
  try {
    // Get database path based on current user
    const pubkey = await getCurrentUser();
    const dbPath = getDBPath(pubkey);
    debugWorker("Connecting to database:", dbPath);

    const dbInterface = await createDBNode(dbPath);
    const keepDB = new KeepDb(dbInterface);

    // Initialize database
    await keepDB.start();
    debugWorker("Database initialized");

    // Create store instances
    const api = new KeepDbApi(keepDB);

    // Create KeepWorker
    const worker = new KeepWorker({ api });

    // Start worker
    await worker.start();
    console.log("🤖 Keep AI Worker started successfully!");
    console.log("Worker is now running and processing tasks...");
    console.log("Press Ctrl+C to stop the worker.");
    debugWorker("Worker started");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\n🛑 Shutting down worker...");
      try {
        await worker.close();
        await dbInterface.close();
        console.log("✅ Worker stopped gracefully");
        debugWorker("Worker shutdown completed");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error);
        debugWorker("Error during shutdown:", error);
        process.exit(1);
      }
    };

    // Listen for termination signals
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive
    await new Promise(() => {}); // This will run indefinitely until interrupted
  } catch (error) {
    console.error("❌ Failed to start worker:", error);
    debugWorker("Failed to start worker:", error);
    process.exit(1);
  }
}
