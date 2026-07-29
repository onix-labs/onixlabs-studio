import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isModalWindow } from './helpers';
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
 * Provides the per-suite options tests can set through `test.use(...)`.
 */
interface StudioOptions {
  /**
   * Seeds the isolated userData directory's `trusted-paths.json` before the application launches,
   * so the main process will honour re-opening the listed fixture files — exactly as a real prior
   * "open" would have recorded them. Undefined for suites that need no seeding.
   */
  readonly trustedPaths: readonly string[] | undefined;
}

/**
 * Holds the repository root, which is also the Electron application directory (`package.json`
 * `main` points at the bundled `dist-electron/electron/main.js`).
 */
const REPO_ROOT: string = path.resolve(__dirname, '..');

export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & StudioFixtures & StudioOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = base.extend<StudioFixtures & StudioOptions>({
  trustedPaths: [undefined, { option: true }],
  app: async (
    { trustedPaths }: { trustedPaths: readonly string[] | undefined },
    use: (app: ElectronApplication) => Promise<void>,
  ): Promise<void> => {
    const userDataDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));
    if (trustedPaths !== undefined) {
      fs.writeFileSync(path.join(userDataDir, 'trusted-paths.json'), JSON.stringify(trustedPaths));
    }
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
    // The application opens more than one window: the main window, plus the welcome screen's own
    // window (and any modal). The main window is the one loading the shell itself — it is created
    // first, but is hidden while no tabs are open, so tests must resolve it by identity rather
    // than by being first or by being visible.
    let page: Page = await app.firstWindow();
    while (isModalWindow(page)) {
      page = await app.waitForEvent('window', {
        predicate: (window: Page): boolean => !isModalWindow(window),
      });
    }
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
