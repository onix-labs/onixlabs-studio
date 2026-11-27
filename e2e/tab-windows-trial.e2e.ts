// TRIAL (#1593) — throwaway: moves a live title-strip tab into a second same-renderer window and back,
// and records what survives the move.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  documentTab,
  explorerRow,
  MOD,
  openFolderFromWelcome,
  openTabFromWelcome,
} from './helpers';

/**
 * Records a finding for the trial's write-up, in a file the container shares with the checkout.
 * @param type What was measured.
 * @param description What it showed.
 */
function note(type: string, description: string): void {
  fs.mkdirSync('test-results', { recursive: true });
  fs.appendFileSync(
    path.join('test-results', 'trial-findings.txt'),
    `${test.info().title} :: ${type} :: ${description}\n`,
  );
}

/**
 * Moves a tab into a window of its own from its context menu, and returns that window, recording
 * every script error raised in it.
 * @param app The launched application.
 * @param page The main application window.
 * @param type The tab's type.
 * @returns Returns the new window and the errors it raised.
 */
async function moveToNewWindow(
  app: ElectronApplication,
  page: Page,
  type: string,
): Promise<{ window: Page; errors: string[] }> {
  const tab: Locator = page.locator('app-title-strip-tab', {
    has: page.locator(`[role="tab"][data-tab-type="${type}"]`),
  });
  const opened: Promise<Page> = app.waitForEvent('window', {
    predicate: (window: Page): boolean => window.url().includes('studio-panel'),
  });
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Tab in New Window (trial)' }).click();
  const window: Page = await opened;
  const errors: string[] = [];
  window.on('pageerror', (error: Error): void => void errors.push(error.message));
  window.on('console', (message): void => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return { window, errors };
}

/**
 * Records every script error the main window raises from now on.
 * @param page The main application window.
 * @returns Returns the errors, as they arrive.
 */
function mainErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error: Error): void => void errors.push(error.message));
  page.on('console', (message): void => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

test.describe('tab windows (trial, #1593)', () => {
  test('aCodeTab_keepsItsUnsavedTextAndUndo_inANewWindow_andBack', async ({ app, page }) => {
    const errors: string[] = mainErrors(page);
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    await page.locator('app-code-view .monaco-editor .view-lines').click();
    await page.keyboard.type('first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');

    const { window, errors: windowErrors } = await moveToNewWindow(app, page, 'code');

    // The main window let go of the view; the new one shows the same text.
    await expect(page.locator('app-code-view')).toHaveCount(0);
    const lines: Locator = window.locator('app-code-view .monaco-editor .view-lines');
    await expect(lines).toContainText('first');
    await expect(lines).toContainText('second');

    // Undo still knows what was typed before the move.
    await lines.click();
    await window.keyboard.press(`${MOD}+z`);
    await window.waitForTimeout(500);
    note('undo after the move', (await lines.innerText()).includes('second') ? 'lost' : 'kept');
    await window.keyboard.type('third');
    await expect(lines).toContainText('third');

    // The status strip lives in the main window, so it follows the main window's active tab.
    note(
      'status strip in main window',
      await page.locator('app-status-strip-container').innerText(),
    );

    await window.close();
    await expect(page.locator('app-code-view .monaco-editor .view-lines')).toContainText('third');
    note('window errors', windowErrors.join(' | '));
    note('main errors', errors.join(' | '));
  });

  test('aTerminalTab_keepsItsCommandRunning_inANewWindow_andBack', async ({ app, page }) => {
    const errors: string[] = mainErrors(page);
    await page.evaluate((): void => {
      const studio: {
        bridge: { on: (channel: string, listener: (...args: unknown[]) => void) => () => void };
        e2eTerminal?: { output: string[]; exits: unknown[] };
      } = window as never;
      const recorded: { output: string[]; exits: unknown[] } = { output: [], exits: [] };
      studio.e2eTerminal = recorded;
      studio.bridge.on('terminal:data', (_id: unknown, data: unknown): void => {
        recorded.output.push(data as string);
      });
      studio.bridge.on('terminal:exit', (...args: unknown[]): void => {
        recorded.exits.push(args);
      });
    });
    const output: () => Promise<string> = (): Promise<string> =>
      page.evaluate((): string =>
        (window as never as { e2eTerminal: { output: string[] } }).e2eTerminal.output.join(''),
      );
    await openTabFromWelcome(app, page, 'New Terminal', 'app-terminal .terminal.xterm');
    await expect.poll(output).not.toBe('');
    await page.locator('app-terminal .terminal.xterm').click();
    await page.keyboard.type('for i in 1 2 3 4 5 6; do echo tick$i; sleep 1; done');
    await page.keyboard.press('Enter');
    await expect.poll(output).toContain('tick2');

    const { window, errors: windowErrors } = await moveToNewWindow(app, page, 'terminal');

    await expect(window.locator('app-terminal .terminal.xterm')).toBeVisible();
    // The command carries on through the move and finishes.
    await expect.poll(output, { timeout: 15_000 }).toContain('tick6');
    const exits: unknown[] = await page.evaluate(
      (): unknown[] => (window as never as { e2eTerminal: { exits: unknown[] } }).e2eTerminal.exits,
    );
    expect(exits).toEqual([]);
    // What the new window's terminal shows: its buffer, replayed from scrollback.
    const shown: string = await window.evaluate((): string => {
      const rows: Element | null = document.querySelector('app-terminal .xterm-accessibility-tree');
      return rows?.textContent ?? '(no accessibility tree)';
    });
    note('terminal text in new window', shown);

    // Typing in the new window reaches the same shell.
    await window.locator('app-terminal .terminal.xterm').click();
    await window.keyboard.type('echo moved-ok');
    await window.keyboard.press('Enter');
    await expect.poll(output).toContain('moved-ok');

    await window.close();
    await expect(page.locator('app-terminal .terminal.xterm')).toBeVisible();
    note('window errors', windowErrors.join(' | '));
    note('main errors', errors.join(' | '));
  });

  test('aWorkspaceTab_keepsItsOpenDocumentAndExplorer_inANewWindow_andBack', async ({
    app,
    page,
    scratch,
  }) => {
    const errors: string[] = mainErrors(page);
    fs.writeFileSync(path.join(scratch, 'notes.txt'), 'original\n');
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, path.join(scratch, 'notes.txt')).dblclick();
    await expect(documentTab(page, 'notes.txt')).toBeVisible();
    await page.locator('app-directory-view .monaco-editor:visible .view-lines').first().click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type('unsaved edit');

    const { window, errors: windowErrors } = await moveToNewWindow(app, page, 'directory');

    await expect(page.locator('app-directory-view')).toHaveCount(0);
    await expect(window.locator('app-directory-view')).toBeVisible();
    await expect(documentTab(window, 'notes.txt')).toBeVisible();
    await expect(
      window.locator('app-directory-view .monaco-editor:visible .view-lines').first(),
    ).toContainText('unsaved edit');
    await expect(explorerRow(window, path.join(scratch, 'notes.txt'))).toBeVisible();

    await window.close();
    await expect(page.locator('app-directory-view')).toBeVisible();
    await expect(
      page.locator('app-directory-view .monaco-editor:visible .view-lines').first(),
    ).toContainText('unsaved edit');
    note('window errors', windowErrors.join(' | '));
    note('main errors', errors.join(' | '));
  });

  test('aTabWindow_stillUpdates_whileTheMainWindowIsHidden', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    const { window } = await moveToNewWindow(app, page, 'code');
    const lines: Locator = window.locator('app-code-view .monaco-editor .view-lines');
    await lines.click();

    /**
     * Types a word and measures how long the editor takes to show it.
     * @param word The word.
     * @returns Returns the milliseconds.
     */
    async function timeToShow(word: string): Promise<number> {
      const started: number = Date.now();
      await window.keyboard.type(word);
      await expect(lines).toContainText(word, { timeout: 60_000 });
      return Date.now() - started;
    }

    const shown: number = await timeToShow('visible');
    await app.evaluate(({ BrowserWindow }): void => {
      BrowserWindow.getAllWindows()
        .find(
          (each) =>
            each.webContents.getURL().startsWith('http') ||
            each.webContents.getURL().startsWith('file'),
        )
        ?.hide();
    });
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 3_000));
    const hidden: number = await timeToShow('hidden');
    const angularTick: number = await window.evaluate(async (): Promise<number> => {
      // How long the main realm's animation frame takes to come, with the main window hidden.
      const opener: Window = window.opener as Window;
      const started: number = performance.now();
      await new Promise<void>((resolve: () => void): void => {
        const timer: number = opener.setTimeout((): void => resolve(), 5_000);
        opener.requestAnimationFrame((): void => {
          opener.clearTimeout(timer);
          resolve();
        });
      });
      return performance.now() - started;
    });
    note(
      'typing to screen, ms',
      `main visible ${shown}, main hidden ${hidden}; main-realm rAF while hidden ${Math.round(angularTick)} ms (5000 = never)`,
    );
    expect(hidden).toBeLessThan(5_000);
  });
});
