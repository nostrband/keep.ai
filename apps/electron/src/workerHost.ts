import { Worker } from "node:worker_threads";
import path from "node:path";
import debug from "debug";

const debugElectronWorkerHost = debug("electron:workerHost");

export function startWorker() {
  const workerPath = path.join(__dirname, "../../packages/worker/dist/node/node-worker.cjs");
  const worker = new Worker(workerPath);
  
  worker.on('error', (error) => {
    debugElectronWorkerHost('Worker error:', error);
  });
  
  worker.on('exit', (code) => {
    debugElectronWorkerHost(`Worker stopped with exit code ${code}`);
  });
  
  return worker;
}