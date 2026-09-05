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

  /**
   * Seeds decoder plugins into the isolated userData directory's `plugins/` before launch, by copying
   * each named plugin's built `dist` tree.
   *
   * Needed because Studio ships no decoder of its own: without one installed the binary editor shows an
   * offer to install rather than a listing, so a test that asserts instructions has to put one there
   * first — which is also exactly what a user does.
   */
  readonly sideloadPlugins: readonly string[] | undefined;

  /**
   * Seeds a synthetic container-engine plugin into the isolated userData directory's `plugins/`.
   *
   * Written rather than copied from `plugins/`, because an engine plugin's payload is a third-party
   * client binary that the repository does not carry. What the seed has to make true is only that the
   * payload is *present* — which is what decides whether the engine reaches the catalogue — so a stub
   * file standing in for the client is enough to drive every state the surface has: no engine
   * installed, and an engine installed whose socket is not answering.
   */
  readonly sideloadEngine: string | undefined;
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
  sideloadPlugins: [undefined, { option: true }],
  sideloadEngine: [undefined, { option: true }],
  app: async (
    {
      trustedPaths,
      sideloadPlugins,
      sideloadEngine,
    }: {
      trustedPaths: readonly string[] | undefined;
      sideloadPlugins: readonly string[] | undefined;
      sideloadEngine: string | undefined;
    },
    use: (app: ElectronApplication) => Promise<void>,
  ): Promise<void> => {
    const userDataDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));
    if (trustedPaths !== undefined) {
      fs.writeFileSync(path.join(userDataDir, 'trusted-paths.json'), JSON.stringify(trustedPaths));
    }
    for (const plugin of sideloadPlugins ?? []) {
      seedPlugin(userDataDir, plugin);
    }
    if (sideloadEngine !== undefined) {
      seedEnginePlugin(userDataDir, sideloadEngine);
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

/**
 * Writes a synthetic container-engine plugin into a test profile's sideload directory.
 *
 * The socket it names cannot exist, which is deliberate: the engine is then *installed but not
 * running*, the one state a test can reach without a real container engine on the machine, and the
 * one the surface has the most to say about.
 * @param userDataDir The isolated userData directory.
 * @param displayName The engine's display name, which is what the surface calls it.
 */
function seedEnginePlugin(userDataDir: string, displayName: string): void {
  const id: string = 'e2e-engine';
  const target: string = path.join(userDataDir, 'plugins', id);
  fs.mkdirSync(path.join(target, 'payload'), { recursive: true });
  fs.writeFileSync(path.join(target, 'payload', 'engine-cli'), '', 'utf8');
  const socket: string = path.join(userDataDir, 'never-served.sock');
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({
      id,
      name: displayName,
      description: 'A container engine, for end-to-end tests.',
      version: '1.0.0',
      apiVersion: '1.6.0',
      // A download per platform, naming an archive that was never published: a manifest whose archive
      // provision publishes no platform at all is refused by validation, and the payload beside the
      // manifest is what actually resolves, so the URL is never fetched.
      provision: {
        kind: 'archive',
        downloads: Object.fromEntries(
          ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'].map(
            (platform: string): [string, unknown] => [
              platform,
              {
                url: 'https://example.invalid/never-published.tar.gz',
                sha256: '0'.repeat(64),
                archive: 'tar.gz',
                executablePath: 'payload/engine-cli',
              },
            ],
          ),
        ),
      },
      contributes: {
        containerEngines: [
          {
            id: 'e2e',
            displayName,
            priority: 100,
            entryPoint: 'payload/engine-cli',
            discovery: {
              hostVariable: 'E2E_CONTAINER_HOST',
              sockets: { darwin: [socket], linux: [socket], win32: ['\\\\.\\pipe\\e2e'] },
            },
            startCommands: { darwin: 'e2e engine start', linux: 'e2e engine start' },
          },
        ],
      },
      requires: [],
    }),
    'utf8',
  );
}

/**
 * Copies a built decoder plugin into a test profile's sideload directory.
 *
 * Fails loudly rather than launching without it: a missing plugin would show up as a test asserting
 * instructions against an empty panel, which reads as a decoder bug rather than a missing build step.
 * @param userDataDir The isolated userData directory.
 * @param plugin The plugin directory name under `plugins/`.
 */
function seedPlugin(userDataDir: string, plugin: string): void {
  const dist: string = path.join(REPO_ROOT, 'plugins', plugin, 'dist');
  if (!fs.existsSync(dist)) {
    throw new Error(`Plugin '${plugin}' has not been built. Run: node plugins/${plugin}/build.mjs`);
  }
  const manifest: { id: string } = JSON.parse(
    fs.readFileSync(path.join(dist, 'plugin.json'), 'utf8'),
  ) as { id: string };
  const target: string = path.join(userDataDir, 'plugins', manifest.id);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(dist, target, { recursive: true });
}
