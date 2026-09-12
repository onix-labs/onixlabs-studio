import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow } from './helpers';

/**
 * Opens the Plugin Manager from the welcome screen.
 *
 * Not `openTabFromWelcome`, which clicks an action directly: the welcome screen is a single-open
 * accordion with Get Started open, and the Plugin Manager lives under Tools — so the group has to be expanded
 * before its actions exist in the DOM at all.
 * @param app The Electron application.
 * @param page The main window.
 */
async function openPlugins(app: ElectronApplication, page: Page): Promise<void> {
  const welcome: Page = await modalWindow(app);
  await welcome.getByRole('button', { name: 'Tools' }).click();
  await welcome.getByText('Plugin Manager', { exact: true }).click();
  await expect(page.locator('app-plugin-manager-view')).toBeVisible();
}

/**
 * Resolves the Plugin Manager row for a plugin, by the name it is listed under.
 * @param page The main window.
 * @param name The plugin's display name.
 * @returns Returns the row locator.
 */
function pluginRow(page: Page, name: string): Locator {
  return page
    .locator('.plugin-row')
    .filter({ has: page.locator('.plugin-row__name', { hasText: name }) });
}

/**
 * The Plugin Manager against the catalogue a fresh installation actually offers (#647).
 *
 * What these can assert is bounded by what a test machine has: installing a real debugger means a
 * download of tens of megabytes and a debuggee to point it at, so that stays a manual test. These cover
 * the part that broke silently before — whether a contribution reaches the catalogue at all — for both
 * ways a plugin can arrive.
 */
test.describe('the plugin catalogue', () => {
  test('offersTheDebugAdaptersAsPluginsRatherThanShippingThem', async ({ app, page }) => {
    await openPlugins(app, page);

    // Core ships no debug adapter. Both of these are entries in the curated index, and reaching the
    // catalogue at all is what proves the contribution point is wired rather than merely declared —
    // it had no occupants for the whole time it existed.
    for (const name of ['.NET Debugger (netcoredbg)', 'Node Debugger (js-debug)']) {
      const row: Locator = pluginRow(page, name);
      await expect(row).toBeVisible();
      await expect(row.locator('.plugin-row__category')).toHaveText('Debug Adapters');
    }
  });

  test('reportsTheDebuggersAsNotInstalledOnAFreshProfile', async ({ app, page }) => {
    await openPlugins(app, page);
    const row: Locator = pluginRow(page, 'Python Debugger (debugpy)');

    // The point of the delivery model: a fresh installation carries no debugger, and says so, rather
    // than bundling one nobody asked for.
    await expect(row).toBeVisible();
    await expect(row.locator('.plugin-row__state')).not.toHaveText('Installed');
  });
});

test.describe('a sideloaded plugin', () => {
  test.use({ sideloadAdapter: 'Zig Debugger' });

  test('reachesTheCatalogueBesideTheIndexedOnes', async ({ app, page }) => {
    await openPlugins(app, page);
    const row: Locator = pluginRow(page, 'Zig Debugger');

    // Nothing in core knows this adapter exists: its manifest alone put it there, which is the whole
    // claim the contribution point makes.
    await expect(row).toBeVisible();
    await expect(row.locator('.plugin-row__category')).toHaveText('Debug Adapters');
    // Its payload sits beside the manifest, so it is installed without anything being fetched.
    await expect(row.locator('.plugin-row__state')).toHaveText('Installed');
  });
});
