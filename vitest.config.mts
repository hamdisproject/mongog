import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // mongodb-memory-server downloads real mongod binaries on first run and
    // replica-set elections take time; generous timeouts are deliberate.
    testTimeout: 180_000,
    hookTimeout: 240_000,
    pool: 'forks',
    maxWorkers: 2,
    reporters: ['default'],
  },
});
