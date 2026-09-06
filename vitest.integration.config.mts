import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/fixtures/global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 240_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 2,
    reporters: ['default'],
  },
});
