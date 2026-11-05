import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  documentTab,
  editorLines,
  explorerRow,
  isModalWindow,
  MOD,
  modalWindow,
  openFolderFromWelcome,
  ribbonButton,
} from './helpers';

/**
 * Lays out a project in which a word appears in some files, more than once in one of them, and not at
 * all in another.
 * @param folder The folder to fill.
 * @returns Returns the paths of the files.
 */
function writeProject(folder: string): { first: string; second: string; other: string } {
  const first: string = path.join(folder, 'first.txt');
  const second: string = path.join(folder, 'nested', 'second.txt');
  const other: string = path.join(folder, 'other.txt');
  fs.mkdirSync(path.dirname(second));
  fs.writeFileSync(first, 'needle one\nnothing here\nneedle two\n');
  fs.writeFileSync(second, 'a needle three\n');
  fs.writeFileSync(other, 'hay only\n');
  return { first, second, other };
}

/**
 * Opens the workspace's Find & Replace panel with its own chord and returns it.
 * @param page The main application window.
 * @returns Returns the panel.
 */
async function openSearch(page: Page): Promise<Locator> {
  await page.keyboard.press(`${MOD}+Shift+F`);
  const panel: Locator = page.locator('app-search-view');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Runs a search for a word across the workspace.
 * @param panel The Find & Replace panel.
 * @param word The word to find.
 */
async function find(panel: Locator, word: string): Promise<void> {
  await panel.getByRole('searchbox', { name: 'Find' }).fill(word);
  await panel.getByRole('button', { name: 'Find', exact: true }).click();
}

test.describe('find in files', () => {
  test('find_listsEveryMatch_groupedByFile_andSkipsFilesWithoutOne', async ({
    app,
    page,
    scratch,
  }) => {
    writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await openSearch(page);

    await find(panel, 'needle');

    await expect(panel.locator('.search-view__summary')).toContainText('3');
    await expect(panel.locator('.search-view__results')).toContainText('first.txt');
    await expect(panel.locator('.search-view__results')).toContainText('second.txt');
    await expect(panel.locator('.search-view__results')).not.toContainText('other.txt');
  });

  test('chooseAMatch_opensItsFile', async ({ app, page, scratch }) => {
    writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await openSearch(page);
    await find(panel, 'three');

    await panel.locator('.search-results__preview', { hasText: 'three' }).click();

    await expect(documentTab(page, 'second.txt')).toBeVisible();
    await expect(editorLines(page)).toContainText('a needle three');
  });

  test('replaceAll_askedFirst_changesEveryMatchOnDisk_andNothingElse', async ({
    app,
    page,
    scratch,
  }) => {
    const { first, second, other } = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await openSearch(page);
    await panel.getByRole('tab', { name: 'Replace in Files' }).click();
    await panel.getByRole('textbox', { name: 'Replace with' }).fill('pin');
    await find(panel, 'needle');
    await expect(panel.locator('.search-view__summary')).toContainText('3');

    await panel.getByRole('button', { name: 'Replace All', exact: true }).click();
    const confirm: Page = await modalWindow(app);
    await expect(confirm.getByText('3 replacements in 2 files.')).toBeVisible();
    // Nothing is touched while the question stands: the change has no undo.
    expect(fs.readFileSync(first, 'utf8')).toContain('needle');
    await confirm.getByRole('button', { name: 'Replace All', exact: true }).click();

    await expect
      .poll((): string => fs.readFileSync(first, 'utf8'))
      .toBe('pin one\nnothing here\npin two\n');
    await expect.poll((): string => fs.readFileSync(second, 'utf8')).toBe('a pin three\n');
    expect(fs.readFileSync(other, 'utf8')).toBe('hay only\n');
  });

  test('replaceAll_cancelled_leavesEveryFileAlone', async ({ app, page, scratch }) => {
    const { first } = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    const panel: Locator = await openSearch(page);
    await panel.getByRole('tab', { name: 'Replace in Files' }).click();
    await panel.getByRole('textbox', { name: 'Replace with' }).fill('pin');
    await find(panel, 'needle');
    await expect(panel.locator('.search-view__summary')).toContainText('3');

    await panel.getByRole('button', { name: 'Replace All', exact: true }).click();
    const confirm: Page = await modalWindow(app);
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    await expect.poll((): number => app.windows().filter(isModalWindow).length).toBe(0);
    expect(fs.readFileSync(first, 'utf8')).toContain('needle');
  });

  test('replaceAll_leavesAFileWithUnsavedEditsAlone_andSaysSo', async ({ app, page, scratch }) => {
    const { first, second } = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, first).dblclick();
    await editorLines(page).click();
    await page.keyboard.type('unsaved');
    await expect(documentTab(page, 'first.txt').locator('.dock-tab__dirty')).toBeVisible();
    const panel: Locator = await openSearch(page);
    await panel.getByRole('tab', { name: 'Replace in Files' }).click();
    await panel.getByRole('textbox', { name: 'Replace with' }).fill('pin');
    await find(panel, 'needle');
    await expect(panel.locator('.search-view__results')).toContainText('second.txt');

    await panel.getByRole('button', { name: 'Replace All', exact: true }).click();
    const confirm: Page = await modalWindow(app);
    await expect(confirm.getByText('Files with unsaved edits are left alone.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Replace All', exact: true }).click();

    await expect.poll((): string => fs.readFileSync(second, 'utf8')).toBe('a pin three\n');
    expect(fs.readFileSync(first, 'utf8')).toBe('needle one\nnothing here\nneedle two\n');
    // Saved so the application can close without a prompt of its own.
    await (await ribbonButton(page, 'Save')).click();
    await expect(documentTab(page, 'first.txt').locator('.dock-tab__dirty')).toBeHidden();
  });
});
