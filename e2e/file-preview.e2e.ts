import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { documentTab, editorLines, explorerRow, openFolderFromWelcome } from './helpers';

/**
 * Lays out three small text files, and returns their paths.
 * @param folder The folder to fill.
 * @returns Returns the paths.
 */
function writeFiles(folder: string): { one: string; two: string; three: string } {
  const one: string = path.join(folder, 'one.txt');
  const two: string = path.join(folder, 'two.txt');
  const three: string = path.join(folder, 'three.txt');
  fs.writeFileSync(one, 'first file\n');
  fs.writeFileSync(two, 'second file\n');
  fs.writeFileSync(three, 'third file\n');
  return { one, two, three };
}

/**
 * Finds the tabs of the workspace's document well.
 * @param page The main application window.
 * @returns Returns the tabs.
 */
function wellTabs(page: Page): Locator {
  return page.locator('app-dock-tab-group .dock-tab:visible').filter({ hasText: '.txt' });
}

test.describe('file preview', () => {
  test('aClick_previewsInOneTab_whichTheNextClickTakesOver', async ({ app, page, scratch }) => {
    const { one, two } = writeFiles(scratch);
    await openFolderFromWelcome(app, page, scratch);

    await explorerRow(page, one).click();
    await expect(editorLines(page)).toContainText('first file');
    await expect(documentTab(page, 'one.txt')).toHaveClass(/dock-tab--preview/);
    await expect(documentTab(page, 'one.txt').locator('.dock-tab__label')).toHaveCSS(
      'font-style',
      'italic',
    );

    await explorerRow(page, two).click();

    await expect(editorLines(page)).toContainText('second file');
    await expect(wellTabs(page)).toHaveCount(1);
    await expect(documentTab(page, 'two.txt')).toHaveClass(/dock-tab--preview/);
  });

  test('aDoubleClick_opensTheFileProperly_andTheNextPreviewGetsItsOwnTab', async ({
    app,
    page,
    scratch,
  }) => {
    const { one, two } = writeFiles(scratch);
    await openFolderFromWelcome(app, page, scratch);

    await explorerRow(page, one).dblclick();
    await expect(documentTab(page, 'one.txt')).toBeVisible();
    await expect(documentTab(page, 'one.txt')).not.toHaveClass(/dock-tab--preview/);

    await explorerRow(page, two).click();

    await expect(wellTabs(page)).toHaveCount(2);
    await expect(documentTab(page, 'two.txt')).toHaveClass(/dock-tab--preview/);
  });

  test('editingAPreview_orDoubleClickingItsTab_keepsIt', async ({ app, page, scratch }) => {
    const { one, two, three } = writeFiles(scratch);
    await openFolderFromWelcome(app, page, scratch);

    await explorerRow(page, one).click();
    await expect(editorLines(page)).toContainText('first file');
    await editorLines(page).click();
    await page.keyboard.type('edited ');
    await expect(documentTab(page, 'one.txt')).not.toHaveClass(/dock-tab--preview/);

    await explorerRow(page, two).click();
    await expect(documentTab(page, 'two.txt')).toHaveClass(/dock-tab--preview/);
    await documentTab(page, 'two.txt').dblclick();
    await expect(documentTab(page, 'two.txt')).not.toHaveClass(/dock-tab--preview/);

    await explorerRow(page, three).click();

    await expect(wellTabs(page)).toHaveCount(3);
    await expect(documentTab(page, 'three.txt')).toHaveClass(/dock-tab--preview/);
  });

  test('aClick_leavesTheKeyboardInTheExplorer', async ({ app, page, scratch }) => {
    const { one, two } = writeFiles(scratch);
    await openFolderFromWelcome(app, page, scratch);

    await explorerRow(page, one).click();
    await expect(editorLines(page)).toContainText('first file');

    await expect(explorerRow(page, one)).toBeFocused();
    // Enter opens the row properly, as a double click does.
    await page.keyboard.press('Enter');
    await expect(documentTab(page, 'one.txt')).not.toHaveClass(/dock-tab--preview/);
    await explorerRow(page, two).click();
    await expect(wellTabs(page)).toHaveCount(2);
  });
});
