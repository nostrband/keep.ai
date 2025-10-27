import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "../../packages"),
    },
  },
  define: {
    global: "globalThis",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    include: ["refractor", "refractor/core"],
    exclude: [
      "@app/sync",
      "@app/db",
      "@app/browser",
      "@vlcn.io/crsqlite-wasm",
    ],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    fs: {
      allow: ["..", "../.."],
    },
  },
  build: {},
});
