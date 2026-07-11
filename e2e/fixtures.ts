import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  _electron as electron,
  ElectronApplication,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  test as base,
  TestType,
} from '@playwright/test';

/**
 * Provides the fixtures shared by every ONIXLabs Studio end-to-end test: a freshly launched
 * Electron application backed by an isolated, throwaway userData directory (so runs never read or
 * clobber real app state), and its first window settled past the welcome screen render.
 */
interface StudioFixtures {
  /**
   * Gets the launched Electron application.
   */
  readonly app: ElectronApplication;

  /**
   * Gets the application's main window, ready for interaction.
   */
  readonly page: Page;
}

/**
 * Holds the repository root, which is also the Electron application directory (`package.json`
 * `main` points at the bundled `dist-electron/electron/main.js`).
 */
const REPO_ROOT: string = path.resolve(__dirname, '..');

export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & StudioFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = base.extend<StudioFixtures>({
  // Playwright derives a fixture's dependencies from the destructuring pattern, so a dependency-free
  // fixture takes the empty pattern.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use: (app: ElectronApplication) => Promise<void>): Promise<void> => {
    const userDataDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));
    const app: ElectronApplication = await electron.launch({
      args: [
        '.',
        // CI runners lack a usable Chromium sandbox (unprivileged user namespaces are restricted);
        // locally the sandbox stays on.
        ...(process.env['CI'] !== undefined ? ['--no-sandbox'] : []),
      ],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        STUDIO_USER_DATA_DIR: userDataDir,
      },
    });
    await use(app);
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  page: async (
    { app }: { app: ElectronApplication },
    use: (page: Page) => Promise<void>,
  ): Promise<void> => {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
