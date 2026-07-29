import { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome } from './helpers';

/**
 * Settings flows: the title-bar gear opens the full-bleed settings tab exactly once. The gear
 * lives in the title strip, which appears once the first tab is open.
 */
test.describe('settings', () => {
  test('settingsGear_opensTheSettingsTab_andDisablesItself', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    const gear: Locator = page.getByRole('button', { name: 'Settings', exact: true });
    await expect(gear).toBeEnabled();

    await gear.click();

    await expect(page.locator('app-settings-view')).toBeVisible();
    await expect(page.locator('app-settings-view')).toContainText('Appearance');
    // The gear guards against duplicate settings tabs while one exists.
    await expect(gear).toBeDisabled();
  });
});
