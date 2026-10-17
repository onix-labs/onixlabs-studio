import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  GIT_CATALOGUE_VERSION,
  GIT_ID,
  INSTALLED_VERSION,
  invoke,
  seedGitInstall,
  UnkeyedPluginContribution,
} from './seeded-installs';
import { modalWindow } from './helpers';

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
 * Reads Git's summary as the renderer receives it.
 * @param page The main window.
 * @returns Returns the summary.
 */
async function gitSummary(page: Page): Promise<PluginSummary | undefined> {
  const plugins: readonly PluginSummary[] = await invoke<readonly PluginSummary[]>(
    page,
    'plugins:list',
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
      expect(summary?.version).toBe(GIT_CATALOGUE_VERSION);
      expect(summary?.installedVersion).toBe(INSTALLED_VERSION);
      expect(summary?.contributionsUnconfirmed).toBeUndefined();
      const system: UnkeyedPluginContribution | undefined = summary?.contributions[0];
      expect(system?.capabilities).toEqual(['stagingArea', 'clone']);
    });

    test('setupWizard_offersNoIdentityStep_theInstalledVersionCannotTake', async ({ app }) => {
      // The catalogue's Git has an identity, so before #878 this rail grew a Git step here.
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
      // The built plugin is the catalogue's own, so its handshake confirms an identity: the step appears,
      // but only once the running plugin has said so.
      const wizard: Page = await modalWindow(app);
      await expect(wizard.locator('.setup')).toBeVisible();

      await expect
        .poll((): Promise<readonly string[]> => railLabels(wizard), { timeout: 20_000 })
        .toContain('Git');
    });
  });
});
