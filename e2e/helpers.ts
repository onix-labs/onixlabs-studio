import { ElectronApplication, expect, Locator, Page } from '@playwright/test';

/**
 * Holds the fragment identifying a modal window's blank document, which is how a modal window is
 * told apart from the main one.
 */
const MODAL_URL_FRAGMENT: string = '#studio-modal';

/**
 * Determines whether a window is a modal window (the welcome screen, a dialog) rather than the
 * main application window.
 * @param window The window to test.
 * @returns Returns true when the window is a modal window that is still open.
 */
export function isModalWindow(window: Page): boolean {
  return !window.isClosed() && window.url().includes(MODAL_URL_FRAGMENT);
}

/**
 * Resolves the modal window currently open over the application, waiting for it to appear. Modals
 * — including the welcome screen — are presented in their own windows, so a test that drives one
 * acts on the window this returns rather than on the main window.
 *
 * Windows that were already open may be excluded, which is what a test does across a reload: the
 * reload takes the previous modal window with it, and its page can still be listed (not yet marked
 * closed) while the fresh one is being opened.
 * @param app The launched application.
 * @param exclude The windows to ignore, if any.
 * @returns Returns the modal window.
 */
export async function modalWindow(
  app: ElectronApplication,
  exclude: readonly Page[] = [],
): Promise<Page> {
  const isFresh: (window: Page) => boolean = (window: Page): boolean =>
    isModalWindow(window) && !exclude.includes(window);
  const open: Page | undefined = app.windows().find(isFresh);
  if (open !== undefined) {
    return open;
  }
  return app.waitForEvent('window', { predicate: isFresh });
}

/**
 * Opens a document tab from the welcome screen by clicking one of its actions (for example
 * `New Markdown File` or `New Code File`) and waits for the created view to be visible in the main
 * window. The action is clicked in the welcome screen's own window; the tab it creates appears in
 * the main window, which is shown for the first time as it does.
 * @param app The launched application.
 * @param page The main application window.
 * @param action The welcome-screen action text to click.
 * @param viewSelector The tab view element expected to appear (for example `app-markdown-view`).
 */
export async function openTabFromWelcome(
  app: ElectronApplication,
  page: Page,
  action: string,
  viewSelector: string,
): Promise<void> {
  const welcome: Page = await modalWindow(app);
  await welcome.getByText(action).click();
  await expect(page.locator(viewSelector)).toBeVisible();
}

/**
 * Resolves a ribbon button by its accessible name, opening the `More ribbon groups` overflow
 * flyout first when the button's group is scooped behind it at the current window size.
 * @param page The application window.
 * @param name The button's accessible name (its ribbon label).
 * @returns Returns the visible ribbon button locator.
 */
export async function ribbonButton(page: Page, name: string): Promise<Locator> {
  const button: Locator = page.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    return button.first();
  }
  await page.getByRole('button', { name: 'More ribbon groups' }).click();
  await expect(button.first()).toBeVisible();
  return button.first();
}
