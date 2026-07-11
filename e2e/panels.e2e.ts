import { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome, ribbonButton } from './helpers';

/**
 * Panel-layout flows: the ribbon Tools toggles open and close side panels around the editor.
 * (Arrangements persist to localStorage only when a panel is dragged to a new dock position, so
 * persistence is not asserted here.)
 */
test.describe('panels', () => {
  test('outlineToggle_showsAndHidesTheOutlinePanel', async ({ page }) => {
    await openTabFromWelcome(page, 'New Markdown File', 'app-markdown-view');
    const panelHeader: Locator = page
      .locator('app-markdown-view')
      .getByText('Outline', { exact: true });
    await expect(panelHeader).toBeHidden();

    const toggleOn: Locator = await ribbonButton(page, 'Outline');
    await toggleOn.click();
    // Dismiss the overflow flyout if it opened — it floats over the content below.
    await page.keyboard.press('Escape');
    await expect(panelHeader).toBeVisible();

    const toggleOff: Locator = await ribbonButton(page, 'Outline');
    await toggleOff.click();
    await page.keyboard.press('Escape');
    await expect(panelHeader).toBeHidden();
  });
});
