import { expect, test } from './fixtures';

/**
 * Boot and tab-creation flows: the application starts on the welcome screen, and the welcome
 * actions open document tabs in the title strip.
 */
test.describe('welcome & tabs', () => {
  test('boot_showsTheWelcomeScreen', async ({ page }) => {
    await expect(page.locator('app-welcome-screen')).toBeVisible();
    await expect(page.getByText('New Markdown File')).toBeVisible();
  });

  test('newMarkdownFile_opensAMarkdownTab', async ({ page }) => {
    await page.getByText('New Markdown File').click();
    await expect(page.locator('app-markdown-view')).toBeVisible();
  });
});
