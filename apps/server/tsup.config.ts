import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/start.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: true,
  clean: true,
  env: {
    BUILD_GMAIL_SECRET: process.env.BUILD_GMAIL_SECRET || process.env.GMAIL_SECRET || ''
  },
  define: {
    'process.env.BUILD_GMAIL_SECRET': JSON.stringify(process.env.BUILD_GMAIL_SECRET || process.env.GMAIL_SECRET || '')
  }
})