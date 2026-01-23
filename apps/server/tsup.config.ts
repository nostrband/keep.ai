import { defineConfig } from 'tsup'
import fs from 'fs'
import path from 'path'

/**
 * Load OAuth credentials from secrets.build.json or environment variables.
 *
 * For desktop OAuth apps (Google, Notion), client secrets are considered public
 * by design - security relies on redirect URI validation, not secret secrecy.
 * See specs/connectors-00-build-secrets.md for details.
 */
function loadBuildSecrets(): Record<string, string> {
  // Path relative to apps/server directory (../../ goes to project root)
  const secretsPath = path.join(process.cwd(), '../../secrets.build.json')

  if (fs.existsSync(secretsPath)) {
    try {
      return JSON.parse(fs.readFileSync(secretsPath, 'utf-8'))
    } catch (error) {
      console.warn('Warning: Failed to parse secrets.build.json:', error)
    }
  }

  // Fallback to env vars (for CI)
  return {}
}

const secrets = loadBuildSecrets()

/**
 * Get a secret value from secrets.build.json or environment variable.
 * @param key - Key in secrets.build.json
 * @param envKey - Optional env var name (defaults to BUILD_<key>)
 */
function getSecret(key: string, envKey?: string): string {
  return secrets[key] || process.env[envKey || `BUILD_${key}`] || ''
}

// Get all OAuth credentials
const GOOGLE_CLIENT_ID = getSecret('GOOGLE_CLIENT_ID')
const GOOGLE_CLIENT_SECRET = getSecret('GOOGLE_CLIENT_SECRET', 'BUILD_GMAIL_SECRET')
const NOTION_CLIENT_ID = getSecret('NOTION_CLIENT_ID')
const NOTION_CLIENT_SECRET = getSecret('NOTION_CLIENT_SECRET')

// Validate that at least Google credentials are present (required for Gmail)
if (!GOOGLE_CLIENT_SECRET) {
  console.warn(
    'Warning: GOOGLE_CLIENT_SECRET not found. Gmail OAuth will not work.\n' +
    'Set BUILD_GMAIL_SECRET env var or create secrets.build.json at project root.\n' +
    'See secrets.build.example.json for the expected format.'
  )
}

export default defineConfig({
  entry: ['src/server.ts', 'src/start.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: true,
  clean: true,
  define: {
    // Google OAuth credentials (used by Gmail, Drive, Sheets, Docs)
    'process.env.GOOGLE_CLIENT_ID': JSON.stringify(GOOGLE_CLIENT_ID),
    'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(GOOGLE_CLIENT_SECRET),
    // Notion OAuth credentials
    'process.env.NOTION_CLIENT_ID': JSON.stringify(NOTION_CLIENT_ID),
    'process.env.NOTION_CLIENT_SECRET': JSON.stringify(NOTION_CLIENT_SECRET),
    // Legacy alias for backwards compatibility during migration
    'process.env.BUILD_GMAIL_SECRET': JSON.stringify(GOOGLE_CLIENT_SECRET),
  },
})
