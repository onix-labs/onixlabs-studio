import * as fs from 'node:fs';
import * as path from 'node:path';
import { Page } from '@playwright/test';

/**
 * The part of a version-control contribution the plugin suites read. Restated rather than imported:
 * the suites drive the application from outside and compile on their own, as every e2e suite does.
 */
export interface UnkeyedPluginContribution {
  readonly slot: string;
  readonly id: string;
  readonly displayName: string;
  readonly priority: number;
  readonly capabilities?: readonly string[];
}

/**
 * A first-party plugin built in this repository that a suite can seed as installed.
 */
export interface SeedablePlugin {
  /**
   * Gets the plugin's directory under `plugins/`.
   */
  readonly directory: string;

  /**
   * Gets the plugin identifier.
   */
  readonly id: string;

  /**
   * Gets the npm package the payload installs as, which names its entry point.
   */
  readonly packageName: string;
}

/**
 * Holds the Git plugin. The bundled catalogue offers {@link GIT_CATALOGUE_VERSION}, which declares an
 * identity.
 */
export const GIT: SeedablePlugin = {
  directory: 'git',
  id: 'onixlabs.git',
  packageName: '@onixlabs/git',
};

/**
 * Holds the GitHub plugin. The bundled catalogue offers 0.3.0.
 */
export const GITHUB: SeedablePlugin = {
  directory: 'github',
  id: 'onixlabs.github',
  packageName: '@onixlabs/github',
};

/**
 * Holds the Git plugin's identifier.
 */
export const GIT_ID: string = GIT.id;

/**
 * Holds the older version a seeded install is filed under, so the catalogue has moved ahead of it.
 */
export const INSTALLED_VERSION: string = '0.2.0';

/**
 * Holds the repository root, where the built plugins live.
 */
const REPO_ROOT: string = path.resolve(__dirname, '..');

/**
 * Gets the version a plugin's own manifest names — the one the bundled catalogue offers, since the
 * catalogue carries a copy of each first-party manifest. Read rather than written down, so a release
 * that bumps the version does not leave these suites asserting the last one.
 * @param plugin The plugin.
 * @returns Returns the version.
 */
export function catalogueVersion(plugin: SeedablePlugin): string {
  const manifest: { version: string } = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'plugins', plugin.directory, 'plugin.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

/**
 * Holds the version of Git the bundled catalogue offers.
 */
export const GIT_CATALOGUE_VERSION: string = catalogueVersion(GIT);

/**
 * Gets the directory a plugin's tree installs into for a version, exactly as the provisioner lays it
 * out: `<userData>/lsp-servers/<id>/<version>/<platform>`.
 * @param userDataDir The userData directory.
 * @param plugin The plugin.
 * @param version The version.
 * @returns Returns the install directory.
 */
export function installDirectory(
  userDataDir: string,
  plugin: SeedablePlugin,
  version: string,
): string {
  return path.join(
    userDataDir,
    'lsp-servers',
    plugin.id,
    version,
    `${process.platform}-${process.arch}`,
  );
}

/**
 * Writes a plugin's built payload as a completed install of a version. The payload is the real built
 * plugin, so the host can start it and hear its handshake; only the version it is filed under is
 * the test's choice.
 * @param userDataDir The userData directory.
 * @param plugin The plugin.
 * @param version The version to file it under.
 * @returns Returns the entry point.
 */
export function writeInstalledTree(
  userDataDir: string,
  plugin: SeedablePlugin,
  version: string,
): string {
  const built: string = path.join(REPO_ROOT, 'plugins', plugin.directory, 'dist', 'package');
  if (!fs.existsSync(built)) {
    throw new Error(
      `The ${plugin.directory} plugin has not been built. Run: node plugins/${plugin.directory}/build.mjs`,
    );
  }
  const installDir: string = installDirectory(userDataDir, plugin, version);
  const entryPoint: string = path.join(installDir, 'node_modules', plugin.packageName, 'main.js');
  fs.mkdirSync(path.dirname(entryPoint), { recursive: true });
  fs.cpSync(built, path.dirname(entryPoint), { recursive: true });
  fs.writeFileSync(path.join(installDir, '.studio-install-complete'), new Date(0).toISOString());
  return entryPoint;
}

/**
 * Seeds a plugin installed at {@link INSTALLED_VERSION}: its payload where the provisioner puts one,
 * and the install record pointing at it.
 * @param userDataDir The isolated userData directory.
 * @param plugin The plugin.
 * @param contributions What the record says the install contributes, or undefined for a record written
 * before Studio kept them.
 */
export function seedInstall(
  userDataDir: string,
  plugin: SeedablePlugin,
  contributions?: readonly UnkeyedPluginContribution[],
): void {
  const entryPoint: string = writeInstalledTree(userDataDir, plugin, INSTALLED_VERSION);
  fs.writeFileSync(
    path.join(userDataDir, 'plugins.json'),
    JSON.stringify([
      {
        id: plugin.id,
        version: INSTALLED_VERSION,
        installedPath: entryPoint,
        ...(contributions === undefined ? {} : { contributions }),
      },
    ]),
  );
}

/**
 * Seeds Git installed at {@link INSTALLED_VERSION}.
 * @param userDataDir The isolated userData directory.
 * @param contributions What the record says the install contributes, or undefined for a record written
 * before Studio kept them.
 */
export function seedGitInstall(
  userDataDir: string,
  contributions: readonly UnkeyedPluginContribution[] | undefined,
): void {
  seedInstall(userDataDir, GIT, contributions);
}

/**
 * Holds the fake live-session harness's plugin and harness identifier.
 */
export const FAKE_HARNESS_ID: string = 'e2e.live-harness';

/**
 * Holds the version the fake harness is installed at.
 */
const FAKE_HARNESS_VERSION: string = '1.0.0';

/**
 * Seeds the fake live-session harness (`fake-live-harness.mjs`) as an installed plugin Studio manages.
 *
 * Its manifest is sideloaded so the catalogue knows it, but its payload is deliberately **not** beside
 * the manifest: a payload placed by hand is one Studio refuses to remove, and the suites need to remove
 * it. So the payload is filed where an install puts it, with the record naming it, and the Plugin
 * Manager installs and removes it like any other.
 * @param userDataDir The isolated userData directory.
 */
export function seedFakeHarness(userDataDir: string): void {
  const manifestDir: string = path.join(userDataDir, 'plugins', FAKE_HARNESS_ID);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, 'plugin.json'),
    JSON.stringify({
      id: FAKE_HARNESS_ID,
      name: 'E2E Live Harness',
      description: 'A harness that holds a live session open, for end-to-end tests.',
      version: FAKE_HARNESS_VERSION,
      apiVersion: '1.17.0',
      // Never fetched: the payload below is already a complete install, which is all detection asks.
      provision: {
        kind: 'npm',
        lockfileUrl: 'https://example.invalid/never-published.lock.json',
        sha256: '0'.repeat(64),
        executablePath: 'harness.mjs',
      },
      contributes: {
        agentHarnesses: [
          {
            id: FAKE_HARNESS_ID,
            displayName: 'E2E Live Harness',
            connectionAuths: ['none'],
            sessionModel: 'live-harness',
            command: { kind: 'node' },
            entryPoint: 'harness.mjs',
          },
        ],
      },
      requires: [],
    }),
  );
  const installDir: string = path.join(
    userDataDir,
    'lsp-servers',
    FAKE_HARNESS_ID,
    FAKE_HARNESS_VERSION,
    `${process.platform}-${process.arch}`,
  );
  const entryPoint: string = path.join(installDir, 'harness.mjs');
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fake-live-harness.mjs'), entryPoint);
  fs.writeFileSync(path.join(installDir, '.studio-install-complete'), new Date(0).toISOString());
  fs.writeFileSync(
    path.join(userDataDir, 'plugins.json'),
    JSON.stringify([
      { id: FAKE_HARNESS_ID, version: FAKE_HARNESS_VERSION, installedPath: entryPoint },
    ]),
  );
}

/**
 * Invokes a main-process channel from the renderer, the way the application's own services do.
 * @param page The main window.
 * @param channel The IPC channel.
 * @param args The arguments.
 * @returns Returns the answer.
 */
export function invoke<T>(page: Page, channel: string, ...args: readonly unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]: readonly [string, readonly unknown[]]): Promise<T> =>
      (
        window as unknown as {
          bridge: { invoke: (channel: string, ...args: readonly unknown[]) => Promise<T> };
        }
      ).bridge.invoke(name, ...rest),
    [channel, args] as const,
  );
}
