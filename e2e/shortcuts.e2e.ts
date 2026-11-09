import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow, openTabFromWelcome } from './helpers';

/**
 * Gets whether the suite drives a macOS build, where the `Mod` modifier is ⌘ and chords render as
 * symbols; elsewhere `Mod` is Ctrl and chords render in `Ctrl+Shift+S` style.
 */
const IS_MAC: boolean = process.platform === 'darwin';

/**
 * Holds the Playwright name of the platform's `Mod` modifier key.
 */
const MOD: string = IS_MAC ? 'Meta' : 'Control';

/**
 * Keyboard customisation: a capability's Keyboard page rebinds one of its commands, with the change
 * taking effect immediately.
 */
test.describe('keyboard shortcuts', () => {
  test('keyboardSettings_rebindsACommand_effectiveImmediately', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('app-settings-view')).toBeVisible();

    // Shortcuts live on a Keyboard page under each capability. Searching for the command leaves the
    // Keyboard pages that have it in the tree, opened; Markdown's is the one this test rebinds.
    const settings: Locator = page.locator('app-settings-view');
    await settings.getByRole('searchbox', { name: 'Search Settings' }).fill('Save the document as');
    await settings.locator('[role="treeitem"][data-tree-id="markdown-keyboard"]').click();
    const section: Locator = page.locator('app-keyboard-settings');
    await expect(section).toContainText('Save the document as');

    // Rebind "Save the document as…" (markdown) from Mod+Shift+S to Mod+Alt+9 through Set Chord,
    // whose dialog reads the chord in its own window and applies it on Accept.
    const row: Locator = section.locator('.keyboard__row', { hasText: 'Save the document as' });
    const chord: Locator = row.locator('.keyboard__chord');
    const before: readonly Page[] = app.windows();
    await row.getByRole('button', { name: 'Set the shortcut for Save the document as' }).click();
    const dialog: Page = await modalWindow(app, before);
    const reading: Locator = dialog.getByTestId('chord-reading');
    await expect(reading).toBeFocused();
    await dialog.keyboard.press(`${MOD}+Alt+9`);
    await expect(reading.locator('kbd')).toHaveText([
      IS_MAC ? '⌘' : 'Ctrl',
      IS_MAC ? '⌥' : 'Alt',
      '9',
    ]);
    await dialog.getByTestId('chord-accept').getByRole('button').click();
    await expect(chord.locator('kbd')).toHaveText([
      IS_MAC ? '⌘' : 'Ctrl',
      IS_MAC ? '⌥' : 'Alt',
      '9',
    ]);

    // The reset affordance appears for the overridden chord, and restores the default.
    const reset: Locator = row.locator('.keyboard__reset');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(chord.locator('kbd')).toHaveText([
      IS_MAC ? '⌘' : 'Ctrl',
      IS_MAC ? '⇧' : 'Shift',
      'S',
    ]);
  });
});
