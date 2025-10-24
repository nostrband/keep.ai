import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "../../packages")
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@app/sync', '@app/db', '@app/browser', '@vlcn.io/crsqlite-wasm']
  },
  server: {
    fs: {
      allow: ['..', '../..']
    }
  }
})