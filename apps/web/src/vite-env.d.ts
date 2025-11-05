/// <reference types="vite/client" />

declare const __FLAVOR__: string;
declare const __FRONTEND__: boolean;
declare const __SERVERLESS__: boolean;

interface ImportMetaEnv {
  readonly VITE_FLAVOR: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}