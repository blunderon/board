import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/dom',
  testMatch: '*.e2e.ts',
  testIgnore: process.env.PLAYWRIGHT_DOCKER === '1' ? [] : ['**/screenshots.e2e.ts'],
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: 'line',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      pathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}',
    },
  },
  use: {
    channel: process.env.PLAYWRIGHT_DOCKER === '1' ? undefined : 'chrome',
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
