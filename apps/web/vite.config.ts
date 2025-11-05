import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const flavor = mode; // "frontend" or "serverless"
  const isFrontend = mode === "frontend";
  const isServerless = mode === "serverless";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@app": path.resolve(__dirname, "../../packages"),
        // Flavor-specific aliasing for workers
        ...(isServerless
          ? {
              "@/worker": path.resolve(__dirname, "src/worker.serverless.ts"),
              "@/shared-worker": path.resolve(__dirname, "src/shared-worker.serverless.ts")
            }
          : {
              "@/worker": path.resolve(__dirname, "src/worker.ts"),
              "@/shared-worker": path.resolve(__dirname, "src/shared-worker.ts")
            }),
      },
    },
    define: {
      global: "globalThis",
      // Build-time constants (stringified!)
      __FLAVOR__: JSON.stringify(flavor),
      __FRONTEND__: JSON.stringify(isFrontend),
      __SERVERLESS__: JSON.stringify(isServerless),
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
    build: {
      outDir: `dist/${flavor}`, // <- separate directories
      sourcemap: true,
    },
  };
});
