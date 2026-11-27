import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { isModalWindow, modalWindow, MOD } from './helpers';

/**
 * Turns on Open Tabs in New Windows (#1587) and reloads, so the welcome screen opens again under it.
 * @param app The launched application.
 * @param page The main application window.
 */
async function withTabWindows(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate((): void => {
    const stored: Record<string, unknown> = JSON.parse(
      localStorage.getItem('settings') ?? '{}',
    ) as Record<string, unknown>;
    localStorage.setItem('settings', JSON.stringify({ ...stored, 'application.tabWindows': true }));
  });
  const stale: readonly Page[] = app.windows().filter(isModalWindow);
  await page.reload();
  await modalWindow(app, stale);
}

/**
 * Opens a tab from the welcome screen.
 * @param app The launched application.
 * @param page The main application window.
 * @param action The welcome screen's action.
 * @param view The view the tab shows.
 */
async function openTab(
  app: ElectronApplication,
  page: Page,
  action: string,
  view: string,
): Promise<void> {
  if ((await page.locator('app-title-strip-tab').count()) > 0) {
    await page.getByRole('button', { name: 'Welcome' }).click();
  }
  const welcome: Page = await modalWindow(app);
  await welcome.getByText(action).click();
  await expect(page.locator(view)).toBeVisible();
}

/**
 * Moves a tab into a new Studio window from its menu.
 * @param app The launched application.
 * @param page The main application window.
 * @param type The tab's type.
 * @returns Returns the new window.
 */
async function moveToNewWindow(app: ElectronApplication, page: Page, type: string): Promise<Page> {
  const tab: Locator = page.locator('app-title-strip-tab', {
    has: page.locator(`[role="tab"][data-tab-type="${type}"]`),
  });
  const opened: Promise<Page> = app.waitForEvent('window', {
    predicate: (window: Page): boolean => window.url().includes('studio-panel'),
  });
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Tab in New Window' }).click();
  return opened;
}

test.describe('Studio windows (#1587)', () => {
  test('aTabsMenu_offersNoNewWindow_untilTheSettingIsOn', async ({ app, page }) => {
    await openTab(app, page, 'New Code File', 'app-code-view');

    await page.locator('app-title-strip-tab').first().click({ button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Close Tab' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open Tab in New Window' })).toHaveCount(0);
  });

  test('aMovedTab_getsAWholeStudioWindow_andComesBackWhenItCloses', async ({ app, page }) => {
    await withTabWindows(app, page);
    await openTab(app, page, 'New Code File', 'app-code-view');
    await page.locator('app-code-view .monaco-editor .view-lines').click();
    await page.keyboard.type('kept across windows');
    await openTab(app, page, 'New Terminal', 'app-terminal .terminal.xterm');

    const window: Page = await moveToNewWindow(app, page, 'code');

    // The new window is a whole Studio surface: its own title strip with its tab, the ribbon and
    // status strip of that tab, and the tab itself, with its unsaved text.
    await expect(window.locator('app-title-strip-container')).toBeVisible();
    await expect(
      window.locator('app-title-strip-tab [role="tab"][data-tab-type="code"]'),
    ).toBeVisible();
    await expect(window.locator('app-ribbon-strip-container')).toBeVisible();
    await expect(window.locator('app-status-strip-container')).toBeVisible();
    await expect(window.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows',
    );

    // The first window keeps its own tab, ribbon and status strip, and no longer shows the moved one.
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(1);
    await expect(
      page.locator('app-title-strip-tab [role="tab"][data-tab-type="terminal"]'),
    ).toBeVisible();
    await expect(page.locator('app-code-view')).toHaveCount(0);

    // Typing and the status strip work in the new window: the caret's column follows the typing.
    await window.locator('app-code-view .monaco-editor .view-lines').click();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type('!');
    await expect(window.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows!',
    );
    await expect(window.locator('app-status-strip-container')).toContainText('Col 21');

    await window.close();
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(2);
    await expect(page.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows!',
    );
  });

  test('aWindowWhoseLastTabCloses_closesWithIt', async ({ app, page }) => {
    await withTabWindows(app, page);
    await openTab(app, page, 'New Code File', 'app-code-view');
    await openTab(app, page, 'New Terminal', 'app-terminal .terminal.xterm');
    const window: Page = await moveToNewWindow(app, page, 'terminal');
    await expect(window.locator('app-terminal .terminal.xterm')).toBeVisible();

    const closed: Promise<void> = window.waitForEvent('close');
    await window.locator('app-title-strip-tab').getByRole('button', { name: 'Close tab' }).click();
    // A terminal still running its shell asks first.
    const ask: Locator = page.locator('app-terminal-confirm-modal');
    if (await ask.isVisible().catch((): boolean => false)) {
      await ask.getByRole('button', { name: /Close/ }).click();
    }

    await closed;
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(1);
  });
});
