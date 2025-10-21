import { Worker } from "node:worker_threads";
import path from "node:path";
import debug from "debug";

const debugServerWorkerHost = debug("server:workerHost");

export function startWorker() {
  const workerPath = path.join(__dirname, "../../packages/worker/dist/node/node-worker.cjs");
  const worker = new Worker(workerPath);
  
  worker.on('error', (error) => {
    debugServerWorkerHost('Worker error:', error);
  });
  
  worker.on('exit', (code) => {
    debugServerWorkerHost(`Worker stopped with exit code ${code}`);
  });
  
  return worker;
}