import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { answerMessageBoxWith, editorLines, messageBoxesAsked, MOD, modalWindow } from './helpers';

/**
 * Opens a tab from the welcome screen, reopening the welcome screen first when a tab is already open.
 * @param app The launched application.
 * @param page The main application window.
 * @param action The welcome screen's action.
 */
async function openTab(app: ElectronApplication, page: Page, action: string): Promise<void> {
  if ((await page.locator('app-title-strip-tab').count()) > 0) {
    await page.getByRole('button', { name: 'Welcome' }).click();
  }
  const welcome: Page = await modalWindow(app);
  const before: number = await page.locator('app-title-strip-tab').count();
  await welcome.getByText(action).click();
  await expect(page.locator('app-title-strip-tab')).toHaveCount(before + 1);
}

/**
 * Reads the title strip's tabs, in order, by their types: titles can repeat ("New Document").
 * @param page The main application window.
 * @returns Returns the types.
 */
function types(page: Page): Promise<string[]> {
  return page
    .locator('app-title-strip-tab > [role="tab"]')
    .evaluateAll((tabs: Element[]): string[] =>
      tabs.map((tab: Element): string => tab.getAttribute('data-tab-type') ?? ''),
    );
}

/**
 * Finds a tab by its type.
 * @param page The main application window.
 * @param type The tab's type.
 * @returns Returns the tab.
 */
function tabOfType(page: Page, type: string): Locator {
  return page.locator('app-title-strip-tab', {
    has: page.locator(`[role="tab"][data-tab-type="${type}"]`),
  });
}

/**
 * Chooses a command from a tab's context menu.
 * @param page The main application window.
 * @param tab The tab.
 * @param command The command's label.
 */
async function fromMenu(page: Page, tab: Locator, command: string): Promise<void> {
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: command }).click();
}

test.describe('title-strip tabs', () => {
  test('aTabsMenu_movesItToEitherEnd_andClosesIt (#1592)', async ({ app, page }) => {
    await openTab(app, page, 'New Code File');
    await openTab(app, page, 'New Markdown File');
    await openTab(app, page, 'New Terminal');
    expect(await types(page)).toEqual(['code', 'markdown', 'terminal']);

    await fromMenu(page, tabOfType(page, 'code'), 'Move Tab to End');
    await expect
      .poll((): Promise<string[]> => types(page))
      .toEqual(['markdown', 'terminal', 'code']);

    await fromMenu(page, tabOfType(page, 'terminal'), 'Move Tab to Beginning');
    await expect
      .poll((): Promise<string[]> => types(page))
      .toEqual(['terminal', 'markdown', 'code']);

    await fromMenu(page, tabOfType(page, 'markdown'), 'Close Tab');
    await expect.poll((): Promise<string[]> => types(page)).toEqual(['terminal', 'code']);
  });

  test('aRightClick_opensTheMenu_withoutSwitchingToTheTab', async ({ app, page }) => {
    await openTab(app, page, 'New Code File');
    await openTab(app, page, 'New Terminal');
    const showing: Locator = page.locator('app-title-strip-tab [role="tab"][aria-selected="true"]');
    await expect(showing).toHaveAttribute('data-tab-type', 'terminal');

    await tabOfType(page, 'code').click({ button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Close Tab' })).toBeVisible();
    await expect(showing).toHaveAttribute('data-tab-type', 'terminal');
    await page.keyboard.press('Escape');
  });

  test('theCloseChord_onAnEditedTab_asksBeforeClosingIt', async ({ app, page }) => {
    await openTab(app, page, 'New Code File');
    await editorLines(page).click();
    await page.keyboard.type('unsaved work');
    await answerMessageBoxWith(app, 'Cancel');

    await page.keyboard.press(`${MOD}+w`);

    await expect.poll((): Promise<readonly string[]> => messageBoxesAsked(app)).toHaveLength(1);
    await expect(tabOfType(page, 'code')).toBeVisible();
    await expect(editorLines(page)).toContainText('unsaved work');

    // Discarded only so the application can close without a prompt of its own.
    await answerMessageBoxWith(app, "Don't Save");
    await page.keyboard.press(`${MOD}+w`);
    await expect(tabOfType(page, 'code')).toHaveCount(0);
  });
});
