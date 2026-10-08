import * as fs from 'node:fs';
import * as path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow } from './helpers';

/**
 * The part of a version-control contribution these cases read. Restated rather than imported: the
 * suite drives the application from outside and compiles on its own, as every other e2e suite does.
 */
interface UnkeyedPluginContribution {
  readonly slot: string;
  readonly id: string;
  readonly displayName: string;
  readonly priority: number;
  readonly capabilities?: readonly string[];
}

/**
 * The part of a plugin summary these cases read, as the renderer receives it over `plugins:list`.
 */
interface PluginSummary {
  readonly id: string;
  readonly state: string;
  readonly version: string;
  readonly installedVersion: string | null;
  readonly contributions: readonly UnkeyedPluginContribution[];
  readonly contributionsUnconfirmed?: true;
}

/**
 * Holds the repository root, where the built Git plugin lives.
 */
const REPO_ROOT: string = path.resolve(__dirname, '..');

/**
 * Holds the plugin under test. The bundled catalogue offers 0.3.0, which declares a committer identity.
 */
const GIT_ID: string = 'onixlabs.git';

/**
 * Holds the older version each case installs, so the catalogue has moved ahead of what is on disk.
 */
const INSTALLED_VERSION: string = '0.2.0';

/**
 * Writes a Git install at {@link INSTALLED_VERSION} exactly where the provisioner puts one, and the
 * install record pointing at it. The payload is the real built plugin, so the version-control host can
 * start it and hear its handshake; only the version it is filed under is older than the catalogue's.
 * @param userDataDir The isolated userData directory.
 * @param contributions What the record says the install contributes, or undefined for a record written
 * before Studio kept them.
 */
function seedGitInstall(
  userDataDir: string,
  contributions: readonly UnkeyedPluginContribution[] | undefined,
): void {
  const built: string = path.join(REPO_ROOT, 'plugins', 'git', 'dist', 'package');
  if (!fs.existsSync(built)) {
    throw new Error('The Git plugin has not been built. Run: node plugins/git/build.mjs');
  }
  const installDir: string = path.join(
    userDataDir,
    'lsp-servers',
    GIT_ID,
    INSTALLED_VERSION,
    `${process.platform}-${process.arch}`,
  );
  const entryPoint: string = path.join(installDir, 'node_modules', '@onixlabs', 'git', 'main.js');
  fs.mkdirSync(path.dirname(entryPoint), { recursive: true });
  fs.cpSync(built, path.dirname(entryPoint), { recursive: true });
  fs.writeFileSync(path.join(installDir, '.studio-install-complete'), new Date(0).toISOString());
  fs.writeFileSync(
    path.join(userDataDir, 'plugins.json'),
    JSON.stringify([
      {
        id: GIT_ID,
        version: INSTALLED_VERSION,
        installedPath: entryPoint,
        ...(contributions === undefined ? {} : { contributions }),
      },
    ]),
  );
}

/**
 * Reads Git's summary as the renderer receives it.
 * @param page The main window.
 * @returns Returns the summary.
 */
async function gitSummary(page: Page): Promise<PluginSummary | undefined> {
  const plugins: readonly PluginSummary[] = await page.evaluate(
    (): Promise<readonly PluginSummary[]> =>
      (
        window as unknown as {
          bridge: { invoke: (channel: string) => Promise<readonly PluginSummary[]> };
        }
      ).bridge.invoke('plugins:list'),
  );
  return plugins.find((plugin: PluginSummary): boolean => plugin.id === GIT_ID);
}

/**
 * Reads the wizard's rail labels, trimmed.
 * @param wizard The wizard window.
 * @returns Returns the labels in walk order.
 */
async function railLabels(wizard: Page): Promise<readonly string[]> {
  return (await wizard.locator('.setup__step-label').allTextContents()).map((label: string) =>
    label.trim(),
  );
}

/**
 * The capabilities surfaces gate on come from the installed plugin, not the catalogue (#878).
 *
 * Every case installs Git a version behind the catalogue, because that gap is the whole bug: the index
 * described a Git that could do things the one on disk could not, and the setup wizard and the project
 * wizard offered them.
 */
test.describe('plugin capabilities come from the installed version (#878)', () => {
  test.use({ runSetupWizard: true });

  test.describe('an install that recorded what it contributes', () => {
    test.use({
      seedUserData: {
        write: (userDataDir: string): void =>
          seedGitInstall(userDataDir, [
            {
              slot: 'version-control',
              id: GIT_ID,
              displayName: 'Git',
              priority: 100,
              capabilities: ['stagingArea', 'clone'],
            },
          ]),
      },
    });

    test('summary_describesTheInstalledVersion_notTheCatalogues', async ({ page }) => {
      const summary: PluginSummary | undefined = await gitSummary(page);

      expect(summary?.state).toBe('installed');
      expect(summary?.version).toBe('0.3.0');
      expect(summary?.installedVersion).toBe(INSTALLED_VERSION);
      expect(summary?.contributionsUnconfirmed).toBeUndefined();
      const system: UnkeyedPluginContribution | undefined = summary?.contributions[0];
      expect(system?.capabilities).toEqual(['stagingArea', 'clone']);
    });

    test('setupWizard_offersNoIdentityStep_theInstalledVersionCannotTake', async ({ app }) => {
      // The catalogue's 0.3.0 has an identity, so before #878 this rail grew a Git step here.
      const wizard: Page = await modalWindow(app);
      await expect(wizard.locator('.setup')).toBeVisible();

      const labels: readonly string[] = await railLabels(wizard);

      expect(labels).toContain('Version Control');
      expect(labels).not.toContain('Git');
    });
  });

  test.describe('an install from before Studio recorded contributions', () => {
    test.use({
      seedUserData: {
        write: (userDataDir: string): void => seedGitInstall(userDataDir, undefined),
      },
    });

    test('summary_saysItCannotVouchForTheInstalledVersion', async ({ page }) => {
      const summary: PluginSummary | undefined = await gitSummary(page);

      expect(summary?.state).toBe('installed');
      expect(summary?.contributionsUnconfirmed).toBe(true);
    });

    test('setupWizard_asksTheRunningPlugin_andGrowsTheStepItConfirms', async ({ app }) => {
      // The built plugin is the real 0.3.0, so its handshake confirms an identity: the step appears,
      // but only once the running plugin has said so.
      const wizard: Page = await modalWindow(app);
      await expect(wizard.locator('.setup')).toBeVisible();

      await expect
        .poll((): Promise<readonly string[]> => railLabels(wizard), { timeout: 20_000 })
        .toContain('Git');
    });
  });
});
