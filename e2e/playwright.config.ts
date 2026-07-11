import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the ONIXLabs Studio end-to-end suite. Tests drive the real Electron
 * application (built renderer + main, no dev server), so the suite runs one app instance at a time.
 * Build first: `ng build && npm run build:electron`, then `npm run e2e`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  // One Electron application at a time: tests within a file run serially, files share one worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  reporter:
    process.env['CI'] !== undefined
      ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
      : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
