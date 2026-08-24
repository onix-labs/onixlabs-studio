import { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome } from './helpers';

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
 * Keyboard customisation: the Settings Keyboard section rebinds a command, with the change taking
 * effect immediately.
 */
test.describe('keyboard shortcuts', () => {
  test('keyboardSettings_rebindsACommand_effectiveImmediately', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('app-settings-view')).toBeVisible();

    // The settings navigation is a tree, so its sections are tree items rather than buttons.
    await page.locator('app-settings-view').getByRole('treeitem', { name: 'Keyboard' }).click();
    const section: Locator = page.locator('app-keyboard-settings');
    await expect(section).toContainText('Markdown Editor');

    // Rebind "Save the document as…" (markdown) from Mod+Shift+S to Mod+Alt+9.
    const row: Locator = section.locator('.keyboard__row', { hasText: 'Save the document as' });
    const chord: Locator = row.locator('.keyboard__chord');
    await chord.click();
    await expect(chord).toContainText('Press a key combination');
    await page.keyboard.press(`${MOD}+Alt+9`);
    await expect(chord).toContainText(IS_MAC ? '⌘⌥9' : 'Ctrl+Alt+9');

    // The reset affordance appears for the overridden chord, and restores the default.
    const reset: Locator = row.locator('.keyboard__reset');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(chord).toContainText(IS_MAC ? '⌘⇧S' : 'Ctrl+Shift+S');
  });
});
