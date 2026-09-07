import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  preserveOutput: 'failures-only',
  reporter: 'line',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
