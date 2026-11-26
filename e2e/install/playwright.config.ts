import * as path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Holds the folder the run's evidence is written to: the container's mounted output folder, or a
 * folder beside this file when run without one.
 */
const OUTPUT: string = process.env['STUDIO_GATE_OUTPUT'] ?? path.join(__dirname, 'output', 'local');

/**
 * Playwright configuration for the install gate (#1546): one test, which installs Studio, completes a
 * full first-run setup against the real plugin index and restarts it. Run through
 * `npm run e2e:install`, which provides the machine; it is not part of `npm run e2e`, whose files end
 * in `.e2e.ts`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.install.ts',
  // Every plugin is really downloaded, verified and unpacked, one after another.
  timeout: 3 * 60 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  // Never retried: a second attempt would start from a profile the first one set up, and prove
  // nothing about a first run.
  retries: 0,
  outputDir: path.join(OUTPUT, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(OUTPUT, 'report') }]],
});
