import { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { isModalWindow, modalWindow } from './helpers';

/**
 * Reads whether the main window is on screen, from the main process. The welcome screen stands in
 * for the application while no tabs are open, and the main window stays hidden behind it.
 * @param app The launched application.
 * @param page The main application window.
 * @returns Returns true when the main window is visible.
 */
async function mainWindowVisible(app: ElectronApplication, page: Page): Promise<boolean> {
  const handle: unknown = await app.browserWindow(page);
  return (
    handle as { evaluate(fn: (window: { isVisible(): boolean }) => boolean): Promise<boolean> }
  ).evaluate((window: { isVisible(): boolean }): boolean => window.isVisible());
}

/**
 * Boot and tab-creation flows: the application starts on the welcome screen — which stands in for
 * the application in its own window, with the main window hidden behind nothing at all — and the
 * welcome actions open document tabs in the now-shown main window.
 */
test.describe('welcome & tabs', () => {
  test('boot_showsTheWelcomeScreenInItsOwnWindow_withTheMainWindowHidden', async ({
    app,
    page,
  }) => {
    const welcome: Page = await modalWindow(app);

    // The welcome SCREEN's component still lives in the main window's tree; what renders in this
    // window is its content, so the window is identified by what it shows.
    await expect(welcome.locator('.welcome__title')).toContainText('ONIXLabs Studio');
    await expect(welcome.getByText('New Markdown File')).toBeVisible();

    await expect.poll((): Promise<boolean> => mainWindowVisible(app, page)).toBe(false);
  });

  test('newMarkdownFile_opensAMarkdownTab_andShowsTheMainWindow', async ({ app, page }) => {
    const welcome: Page = await modalWindow(app);
    await welcome.getByText('New Markdown File').click();

    await expect(page.locator('app-markdown-view')).toBeVisible();

    await expect.poll((): Promise<boolean> => mainWindowVisible(app, page)).toBe(true);
    // The welcome window closed behind the tab it opened.
    await expect.poll((): number => app.windows().filter(isModalWindow).length).toBe(0);
  });
});
