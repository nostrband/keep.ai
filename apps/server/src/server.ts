import fastify from "fastify";
import { startWorker } from "./workerHost";
import debug from "debug";

const debugServer = debug("server:server");

const app = fastify();
const worker = startWorker();

// Simple in-memory map for request/response handling
const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();

worker.on("message", (msg) => {
  const pending = pendingRequests.get(msg.id);
  if (pending) {
    pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }
});

async function callWorker(worker: any, request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36);
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ ...request, id });
  });
}

app.post("/api/rpc", async (req, reply) => {
  try {
    const result = await callWorker(worker, req.body);
    reply.send(result);
  } catch (error) {
    reply.status(500).send({ error: (error as Error).message });
  }
});

app.register(import('@fastify/static'), { root: __dirname + "/public" });
app.setNotFoundHandler((req, rep) => rep.sendFile("index.html"));

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
    debugServer('Server listening on port', process.env.PORT || 3000);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();