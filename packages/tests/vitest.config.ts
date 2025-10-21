import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    conditions: ['node', 'import', 'default'] // node first
  },
});