import { Command } from "commander";
import { createDBNode, getCurrentUser, getDBPath, getUserPath } from "@app/node";
import debug from "debug";
import { KeepDb, KeepDbApi } from "@app/db";
import { TaskScheduler, WorkflowScheduler } from "@app/agent";

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
    const userPath = getUserPath(pubkey);

    const dbPath = getDBPath(pubkey);
    debugWorker("Connecting to database:", dbPath);

    const dbInterface = await createDBNode(dbPath);
    const keepDB = new KeepDb(dbInterface);

    // Initialize database
    await keepDB.start();
    debugWorker("Database initialized");

    // Create store instances
    const api = new KeepDbApi(keepDB);

    // Create TaskScheduler
    const scheduler = new TaskScheduler({
      api,
      stepLimit: 20,
      userPath
    });

    // Create WorkflowScheduler
    const workflowScheduler = new WorkflowScheduler({
      api,
      userPath
    });

    // Start schedulers
    scheduler.start();
    workflowScheduler.start();
    console.log("🤖 Keep AI Schedulers started successfully!");
    console.log("Task and Workflow schedulers are now running...");
    console.log("Press Ctrl+C to stop the schedulers.");
    debugWorker("Schedulers started");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\n🛑 Shutting down schedulers...");
      try {
        await scheduler.close();
        await workflowScheduler.close();
        await dbInterface.close();
        console.log("✅ Schedulers stopped gracefully");
        debugWorker("Schedulers shutdown completed");
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
    console.error("❌ Failed to start scheduler:", error);
    debugWorker("Failed to start scheduler:", error);
    process.exit(1);
  }
}
