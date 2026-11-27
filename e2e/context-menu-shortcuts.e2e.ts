import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { explorerRow, isModalWindow, MOD, openFolderFromWelcome } from './helpers';

/**
 * Names the chord that deletes a row, as the platform has it.
 */
const DELETE: string = process.platform === 'darwin' ? `${MOD}+Backspace` : 'Delete';

/**
 * Names how the platform writes the chords a row's menu shows.
 */
const SHOWN: { readonly rename: string; readonly delete: string } =
  process.platform === 'darwin'
    ? { rename: 'F2', delete: '⌘⌫' }
    : { rename: 'F2', delete: 'Delete' };

test.describe('context menu shortcuts', () => {
  test('aRowsMenu_showsTheChordsOfRenameAndDelete', async ({ app, page, scratch }) => {
    const notes: string = path.join(scratch, 'notes.txt');
    fs.writeFileSync(notes, 'hello\n');
    await openFolderFromWelcome(app, page, scratch);

    await explorerRow(page, notes).click({ button: 'right' });

    const rename: Locator = page.getByRole('menuitem', { name: 'Rename', exact: true });
    const remove: Locator = page.getByRole('menuitem', { name: 'Delete', exact: true });
    await expect(rename.locator('.app-menu-panel__item-shortcut')).toHaveText(SHOWN.rename);
    await expect(remove.locator('.app-menu-panel__item-shortcut')).toHaveText(SHOWN.delete);
  });

  test('f2_onARow_renamesIt_asItsMenuDoes', async ({ app, page, scratch }) => {
    const notes: string = path.join(scratch, 'notes.txt');
    fs.writeFileSync(notes, 'hello\n');
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, notes).click();

    await page.keyboard.press('F2');
    const field: Locator = page.locator('app-tree-panel app-row-edit-field input');
    await expect(field).toBeFocused();
    await field.fill('renamed.txt');
    await field.press('Enter');

    await expect.poll((): boolean => fs.existsSync(path.join(scratch, 'renamed.txt'))).toBe(true);
    expect(fs.existsSync(notes)).toBe(false);
  });

  test('theDeleteChord_onARow_asksToDeleteIt_asItsMenuDoes', async ({ app, page, scratch }) => {
    const notes: string = path.join(scratch, 'notes.txt');
    fs.writeFileSync(notes, 'hello\n');
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, notes).click();

    // The confirmation is a window of its own; waited for from before the key, so it is not missed.
    const opened: Promise<Page> = app.waitForEvent('window', { predicate: isModalWindow });
    await page.keyboard.press(DELETE);
    const confirmation: Page = await opened;
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect.poll((): boolean => fs.existsSync(notes)).toBe(false);
  });
});
