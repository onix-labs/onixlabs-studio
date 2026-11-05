import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  answerMessageBoxWith,
  documentTab,
  editorLines,
  explorerRow,
  isModalWindow,
  messageBoxesAsked,
  modalWindow,
  openFolderFromWelcome,
  ribbonButton,
} from './helpers';

/**
 * Lays out the small project every case opens, and returns the file they edit.
 * @param folder The folder to fill.
 * @returns Returns the absolute path of `src/alpha.ts`.
 */
function writeProject(folder: string): string {
  const alpha: string = path.join(folder, 'src', 'alpha.ts');
  fs.mkdirSync(path.dirname(alpha));
  fs.writeFileSync(alpha, 'export const alpha = 1;\n');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'first note\n');
  return alpha;
}

/**
 * Opens `src/alpha.ts` from the explorer tree, expanding its folder first.
 * @param page The main application window.
 * @param alpha The file's absolute path.
 */
async function openAlpha(page: Page, alpha: string): Promise<void> {
  await explorerRow(page, path.dirname(alpha)).click();
  await explorerRow(page, alpha).dblclick();
  await expect(editorLines(page)).toContainText('alpha');
}

/**
 * Types a word into the open document, wherever the caret lands. A letters-only word gives auto-closing
 * nothing to act on, and the tests only ask that it arrives, not where.
 * @param page The main application window.
 * @param word The word to type.
 */
async function typeIntoEditor(page: Page, word: string): Promise<void> {
  await editorLines(page).click();
  await page.keyboard.type(word);
  await expect(editorLines(page)).toContainText(word);
}

/**
 * The everyday file journey, on a real folder through the real main process: only the native dialogs
 * are answered for the user.
 */
test.describe('a folder as a workspace', () => {
  test('openFolder_showsItsTree_andExpandingAFolderShowsItsFiles', async ({
    app,
    page,
    scratch,
  }) => {
    const alpha: string = writeProject(scratch);

    await openFolderFromWelcome(app, page, scratch);

    await expect(explorerRow(page, path.join(scratch, 'notes.txt'))).toBeVisible();
    await expect(explorerRow(page, alpha)).toBeHidden();
    await explorerRow(page, path.dirname(alpha)).click();
    await expect(explorerRow(page, alpha)).toBeVisible();
  });

  test('editAndSave_writesTheFile_andClearsTheDirtyMark', async ({ app, page, scratch }) => {
    const alpha: string = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    await openAlpha(page, alpha);
    const dirty: Locator = documentTab(page, 'alpha.ts').locator('.dock-tab__dirty');
    await expect(dirty).toBeHidden();

    await typeIntoEditor(page, 'edited');
    await expect(dirty).toBeVisible();
    // Typing alone leaves the file alone: nothing reaches the disk until the save.
    expect(fs.readFileSync(alpha, 'utf8')).not.toContain('edited');
    await (await ribbonButton(page, 'Save')).click();

    await expect(dirty).toBeHidden();
    expect(fs.readFileSync(alpha, 'utf8')).toContain('edited');
  });

  test('externalChange_toACleanDocument_asksByDefault_andReloadTakesTheDiskVersion', async ({
    app,
    page,
    scratch,
  }) => {
    const alpha: string = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    await openAlpha(page, alpha);

    fs.writeFileSync(alpha, 'export const changedOutside = 2;\n');

    const asked: Page = await modalWindow(app);
    await expect(asked.getByText('File Changed on Disk')).toBeVisible();
    await asked.getByRole('button', { name: 'Reload from disk' }).click();
    await expect(editorLines(page)).toContainText('changedOutside');
  });

  test('externalChange_toADirtyDocument_keepsTheEditsUntilTheUserChooses', async ({
    app,
    page,
    scratch,
  }) => {
    const alpha: string = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    await openAlpha(page, alpha);
    await typeIntoEditor(page, 'unsaved');

    fs.writeFileSync(alpha, 'export const changedOutside = 2;\n');

    const asked: Page = await modalWindow(app);
    await expect(asked.getByRole('button', { name: 'Keep my version' })).toBeVisible();
    await expect(editorLines(page)).toContainText('unsaved');
    await asked.getByRole('button', { name: 'Reload from disk' }).click();
    await expect(editorLines(page)).toContainText('changedOutside');
    await expect(editorLines(page)).not.toContainText('unsaved');
    await expect(documentTab(page, 'alpha.ts').locator('.dock-tab__dirty')).toBeHidden();
    expect(fs.readFileSync(alpha, 'utf8')).toBe('export const changedOutside = 2;\n');
  });

  test('externalChange_keepMyVersion_savesOverTheDiskVersion', async ({ app, page, scratch }) => {
    const alpha: string = writeProject(scratch);
    await openFolderFromWelcome(app, page, scratch);
    await openAlpha(page, alpha);
    await typeIntoEditor(page, 'unsaved');

    fs.writeFileSync(alpha, 'export const changedOutside = 2;\n');
    const asked: Page = await modalWindow(app);
    await asked.getByRole('button', { name: 'Keep my version' }).click();
    await expect.poll((): number => app.windows().filter(isModalWindow).length).toBe(0);

    await expect(editorLines(page)).toContainText('unsaved');
    await (await ribbonButton(page, 'Save')).click();
    await expect(documentTab(page, 'alpha.ts').locator('.dock-tab__dirty')).toBeHidden();
    expect(fs.readFileSync(alpha, 'utf8')).toContain('unsaved');
  });

  test.describe('closing a document with unsaved changes', () => {
    test('cancel_keepsTheDocumentAndItsChanges', async ({ app, page, scratch }) => {
      const alpha: string = writeProject(scratch);
      await openFolderFromWelcome(app, page, scratch);
      await openAlpha(page, alpha);
      await typeIntoEditor(page, 'unsaved');
      await answerMessageBoxWith(app, 'Cancel');

      await documentTab(page, 'alpha.ts').hover();
      await documentTab(page, 'alpha.ts').getByRole('button', { name: 'Close' }).click();

      await expect
        .poll((): Promise<readonly string[]> => messageBoxesAsked(app))
        .toEqual(['Do you want to save changes to "alpha.ts"?']);
      await expect(documentTab(page, 'alpha.ts')).toBeVisible();
      await expect(editorLines(page)).toContainText('unsaved');
      // Saved here only so the application can close without a prompt of its own.
      await (await ribbonButton(page, 'Save')).click();
      await expect(documentTab(page, 'alpha.ts').locator('.dock-tab__dirty')).toBeHidden();
    });

    test('dontSave_closesIt_andLeavesTheFileAsItWas', async ({ app, page, scratch }) => {
      const alpha: string = writeProject(scratch);
      await openFolderFromWelcome(app, page, scratch);
      await openAlpha(page, alpha);
      await typeIntoEditor(page, 'unsaved');
      await answerMessageBoxWith(app, "Don't Save");

      await documentTab(page, 'alpha.ts').hover();
      await documentTab(page, 'alpha.ts').getByRole('button', { name: 'Close' }).click();

      await expect(documentTab(page, 'alpha.ts')).toBeHidden();
      expect(fs.readFileSync(alpha, 'utf8')).toBe('export const alpha = 1;\n');
    });

    test('save_writesTheFile_andCloses', async ({ app, page, scratch }) => {
      const alpha: string = writeProject(scratch);
      await openFolderFromWelcome(app, page, scratch);
      await openAlpha(page, alpha);
      await typeIntoEditor(page, 'unsaved');
      await answerMessageBoxWith(app, 'Save');

      await documentTab(page, 'alpha.ts').hover();
      await documentTab(page, 'alpha.ts').getByRole('button', { name: 'Close' }).click();

      await expect(documentTab(page, 'alpha.ts')).toBeHidden();
      expect(fs.readFileSync(alpha, 'utf8')).toContain('unsaved');
    });
  });
});
