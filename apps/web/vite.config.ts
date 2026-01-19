import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Plugin to inject global polyfill without affecting string replacements
const globalPolyfillPlugin = (): Plugin => ({
  name: "global-polyfill",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      return html.replace(
        "<head>",
        `<head><script>window.global = window;</script>`
      );
    },
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const flavor = mode; // "frontend", "serverless", or "electron"
  const isFrontend = mode === "frontend";
  const isServerless = mode === "serverless";
  const isElectron = mode === "electron";

  return {
    plugins: [globalPolyfillPlugin(), react()],
    resolve: {
      alias: {
        "@app": path.resolve(__dirname, "../../packages"),
      },
    },
    define: {
      // Build-time constants (stringified!)
      __FLAVOR__: JSON.stringify(flavor),
      __FRONTEND__: JSON.stringify(isFrontend),
      __SERVERLESS__: JSON.stringify(isServerless),
      __ELECTRON__: JSON.stringify(isElectron),
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
      esbuildOptions: {},
    },
    server: {
      fs: {
        allow: ["..", "../.."],
      },
    },
    build: {
      outDir: `dist/${flavor}`, // <- separate directories
      sourcemap: true,
      // Service worker stuff
      ...((isServerless || isFrontend) && {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, "index.html"),
            sw: path.resolve(__dirname, "src/service-worker.ts"),
          },
          output: {
            entryFileNames: (chunk) => {
              if (chunk.name === "sw") return "service-worker.js"; // at root
              return "assets/[name]-[hash].js";
            },
          },
        },
      }),
      // Use relative paths only for electron builds
      ...(isElectron && {
        sourcemap: false,
        rollupOptions: {
          output: {
            assetFileNames: "assets/[name]-[hash].[ext]",
            chunkFileNames: "assets/[name]-[hash].js",
            entryFileNames: "assets/[name]-[hash].js",
          },
        },
      }),
    },
    base: isElectron ? "./" : "/", // Use relative base only for electron builds
  };
});
