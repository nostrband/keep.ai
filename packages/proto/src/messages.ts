// Message type constants and utilities
export const MESSAGE_TYPES = {
  WORKER_REQUEST: 'worker:request',
  WORKER_RESPONSE: 'worker:response',
  SYNC_EVENT: 'sync:event',
  AI_REQUEST: 'ai:request',
  AI_RESPONSE: 'ai:response',
  DB_QUERY: 'db:query',
  DB_RESULT: 'db:result',
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

export const TRANSPORT_TYPES = {
  POST_MESSAGE: 'postMessage',
  HTTP: 'http',
  IPC: 'ipc',
  NOSTR: 'nostr',
} as const;

export type TransportType = typeof TRANSPORT_TYPES[keyof typeof TRANSPORT_TYPES];