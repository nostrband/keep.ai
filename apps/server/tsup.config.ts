import { defineConfig } from 'tsup'

// Validate required environment variables at build time
if (!process.env.BUILD_GMAIL_SECRET) {
  throw new Error('BUILD_GMAIL_SECRET environment variable is required at build time')
}

export default defineConfig({
  entry: ['src/server.ts', 'src/start.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: true,
  clean: true,
  env: {
    BUILD_GMAIL_SECRET: process.env.BUILD_GMAIL_SECRET
  },
  define: {
    'process.env.BUILD_GMAIL_SECRET': JSON.stringify(process.env.BUILD_GMAIL_SECRET)
  }
})
