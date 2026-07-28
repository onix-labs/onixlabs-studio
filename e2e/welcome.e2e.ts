import { ElectronApplication, Locator, Page } from '@playwright/test';
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
 * Describes what a window opened with: its size, and which of its controls the platform offers.
 */
interface WindowChrome {
  /**
   * Gets the window's width.
   */
  readonly width: number;

  /**
   * Gets the window's height.
   */
  readonly height: number;

  /**
   * Gets a value indicating whether the user may resize the window.
   */
  readonly resizable: boolean;

  /**
   * Gets a value indicating whether the window offers a maximize control.
   */
  readonly maximizable: boolean;
}

/**
 * Describes the parts of a main-process `BrowserWindow` these tests read.
 */
interface BrowserWindowLike {
  /**
   * Gets the window's bounds.
   * @returns Returns the bounds.
   */
  getBounds(): { width: number; height: number };

  /**
   * Determines whether the user may resize the window.
   * @returns Returns true when the window is resizable.
   */
  isResizable(): boolean;

  /**
   * Determines whether the window offers a maximize control.
   * @returns Returns true when the window is maximizable.
   */
  isMaximizable(): boolean;
}

/**
 * Describes the handle `app.browserWindow` hands back, narrowed to the evaluation these tests do.
 */
interface BrowserWindowHandle {
  /**
   * Runs a function against the window in the main process.
   * @param fn The function to run.
   * @returns Returns the function's result.
   */
  evaluate(fn: (window: BrowserWindowLike) => WindowChrome): Promise<WindowChrome>;
}

/**
 * Reads a window's chrome from the main process: the size it opened at, and which of its controls
 * the platform offers.
 * @param app The launched application.
 * @param page The window to read.
 * @returns Returns the window's width, height, and resize/maximize affordances.
 */
async function windowChrome(app: ElectronApplication, page: Page): Promise<WindowChrome> {
  const handle: unknown = await app.browserWindow(page);
  const browserWindow: BrowserWindowHandle = handle as BrowserWindowHandle;
  return browserWindow.evaluate((window: BrowserWindowLike): WindowChrome => {
    const bounds: { width: number; height: number } = window.getBounds();
    return {
      width: bounds.width,
      height: bounds.height,
      resizable: window.isResizable(),
      maximizable: window.isMaximizable(),
    };
  });
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

  test('welcomeWindow_opensAtItsOwnSize_resizableButNotMaximizable', async ({ app }) => {
    const welcome: Page = await modalWindow(app);

    const chrome: WindowChrome = await windowChrome(app, welcome);

    expect(chrome.width).toBe(1024);
    expect(chrome.height).toBe(720);
    // It may be resized down to its minimum, but it has no size to maximize to.
    expect(chrome.resizable).toBe(true);
    expect(chrome.maximizable).toBe(false);
  });

  test('summonedOverTabs_dismissesWhenTheBackdropIsClicked', async ({ app, page }) => {
    const welcome: Page = await modalWindow(app);
    await welcome.getByText('New Markdown File').click();
    await expect(page.locator('app-markdown-view')).toBeVisible();

    await page.getByRole('button', { name: 'Welcome', exact: true }).click();
    const summoned: Page = await modalWindow(app);
    await expect(summoned.locator('.welcome__title')).toContainText('ONIXLabs Studio');
    const backdrop: Locator = page.locator('app-modal-backdrop');
    await expect(backdrop).toHaveClass(/modal-backdrop--raised/);

    // Clicking the window behind the modal dismisses it, and the blur goes with it.
    await backdrop.click({ position: { x: 20, y: 400 } });

    await expect.poll((): number => app.windows().filter(isModalWindow).length).toBe(0);
    await expect(backdrop).not.toHaveClass(/modal-backdrop--raised/);
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
