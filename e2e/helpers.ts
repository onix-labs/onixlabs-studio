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

/**
 * Holds the Playwright name of the platform's `Mod` modifier key.
 */
export const MOD: string = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Answers the next native open dialogs with a path. A native dialog is outside every window Playwright
 * can reach, so it is stubbed in the main process; everything after the choice is the real thing.
 * @param app The launched application.
 * @param chosen The path the dialog answers with.
 */
export async function answerOpenDialogWith(
  app: ElectronApplication,
  chosen: string,
): Promise<void> {
  await app.evaluate(({ dialog }, target: string): void => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = (): Promise<unknown> =>
      Promise.resolve({ canceled: false, filePaths: [target] });
  }, chosen);
}

/**
 * Answers native message boxes with a button, recording what each one asked. The answer is by label,
 * so the test says what the user clicked rather than where the button happens to sit.
 * @param app The launched application.
 * @param label The button the user presses.
 */
export async function answerMessageBoxWith(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ dialog }, button: string): void => {
    const asked: string[] = [];
    (globalThis as unknown as { e2eMessageBoxes: string[] }).e2eMessageBoxes = asked;
    (dialog as unknown as { showMessageBox: unknown }).showMessageBox = (
      ...args: readonly unknown[]
    ): Promise<unknown> => {
      const options: { message: string; buttons: readonly string[] } = args[
        args.length - 1
      ] as never;
      asked.push(options.message);
      return Promise.resolve({ response: options.buttons.indexOf(button), checkboxChecked: false });
    };
  }, label);
}

/**
 * Reads what the native message boxes have asked since {@link answerMessageBoxWith}.
 * @param app The launched application.
 * @returns Returns each box's message, in order.
 */
export function messageBoxesAsked(app: ElectronApplication): Promise<readonly string[]> {
  return app.evaluate(
    (): readonly string[] =>
      (globalThis as unknown as { e2eMessageBoxes: readonly string[] }).e2eMessageBoxes,
  );
}

/**
 * Opens a folder as a workspace from the welcome screen, through the native dialog's stub.
 * @param app The launched application.
 * @param page The main application window.
 * @param folder The folder to open.
 */
export async function openFolderFromWelcome(
  app: ElectronApplication,
  page: Page,
  folder: string,
): Promise<void> {
  await answerOpenDialogWith(app, folder);
  const welcome: Page = await modalWindow(app);
  await welcome.getByText('Open Directory or File').click();
  await expect(page.locator('app-directory-view')).toBeVisible();
}

/**
 * Finds a row of the workspace's File Explorer. Rows carry their absolute path, so this cannot match
 * another panel's tree or a file of the same name in another folder.
 * @param page The main application window.
 * @param filePath The row's absolute path.
 * @returns Returns the row.
 */
export function explorerRow(page: Page, filePath: string): Locator {
  return page.locator(`[role="treeitem"][data-tree-id="${filePath}"]`);
}

/**
 * Finds the code editor showing in the document well.
 * @param page The main application window.
 * @returns Returns the visible lines of the editor.
 */
export function editorLines(page: Page): Locator {
  return page.locator('.monaco-editor:visible .view-lines').first();
}

/**
 * Finds a document's tab by the file it shows.
 * @param page The main application window.
 * @param fileName The name on the tab.
 * @returns Returns the tab.
 */
export function documentTab(page: Page, fileName: string): Locator {
  return page.locator('.dock-tab', {
    has: page.locator('.dock-tab__label', { hasText: fileName }),
  });
}
