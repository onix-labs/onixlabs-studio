import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { documentTab, openFolderFromWelcome } from './helpers';

/**
 * Lays out a small Node package: a lone project in the workspace's own folder, whose contents the
 * Solution Explorer shows directly beneath the root row.
 * @param folder The folder to fill.
 */
function writeProject(folder: string): void {
  fs.writeFileSync(
    path.join(folder, 'package.json'),
    JSON.stringify({ name: 'sample', version: '1.0.0', main: 'src/index.js' }),
  );
  fs.mkdirSync(path.join(folder, 'src'));
  fs.writeFileSync(path.join(folder, 'src', 'index.js'), 'module.exports = 1;\n');
}

/**
 * Opens the project and brings its Solution Explorer forward.
 * @param page The main application window.
 * @returns Returns the Solution Explorer panel.
 */
async function solutionExplorer(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Solution Explorer' }).click();
  const panel: Locator = page.locator('app-solution-panel');
  await expect(panel.getByRole('treeitem', { name: 'src' })).toBeVisible();
  return panel;
}

/**
 * Chooses a command from a row's context menu, and names the entry it begins in place.
 * @param page The main application window.
 * @param row The row to open the menu on.
 * @param command The command's label.
 * @param name The name to give the new entry.
 */
async function createFrom(page: Page, row: Locator, command: string, name: string): Promise<void> {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: command, exact: true }).click();
  const field: Locator = page.locator('app-solution-panel app-row-edit-field input');
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press('Enter');
}

test.describe('the Solution Explorer', () => {
  test('newFile_onAFolder_createsItThere_andOpensIt', async ({ app, page, scratch }) => {
    writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await solutionExplorer(page);

    await createFrom(page, panel.getByRole('treeitem', { name: 'src' }), 'New File', 'extra.js');

    await expect
      .poll((): boolean => fs.existsSync(path.join(scratch, 'src', 'extra.js')))
      .toBe(true);
    await expect(documentTab(page, 'extra.js')).toBeVisible();
    await expect(panel.getByRole('treeitem', { name: 'extra.js' })).toBeVisible();
  });

  test('newFolder_besideAFile_createsIt_andShowsItThoughItIsEmpty', async ({
    app,
    page,
    scratch,
  }) => {
    writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await solutionExplorer(page);
    await panel.getByRole('treeitem', { name: 'src' }).click();
    const file: Locator = panel.getByRole('treeitem', { name: 'index.js' });
    await expect(file).toBeVisible();

    await createFrom(page, file, 'New Folder', 'models');

    await expect.poll((): boolean => fs.existsSync(path.join(scratch, 'src', 'models'))).toBe(true);
    // A project's tree is built from its files, so nothing lists an empty folder: it shows because it
    // was just made here.
    await expect(panel.getByRole('treeitem', { name: 'models' })).toBeVisible();
  });
});
