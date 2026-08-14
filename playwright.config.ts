import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/dom',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1180, height: 820 },
  },
  webServer: {
    command: 'bun run scripts/serve-example.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
