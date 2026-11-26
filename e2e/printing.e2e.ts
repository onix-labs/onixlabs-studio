import * as fs from 'node:fs';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome, ribbonButton } from './helpers';

/**
 * How many lines are typed, which is more than a printed page holds.
 */
const LINES: number = 120;

/**
 * Exports the active document with the ribbon's Export to PDF, answering its save dialog.
 * @param app The launched application.
 * @param page The main application window.
 * @param file The file to export to.
 * @returns Returns the number of pages exported.
 */
async function exportedPages(app: ElectronApplication, page: Page, file: string): Promise<number> {
  await app.evaluate(({ dialog, shell }, target: string): void => {
    (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = (): Promise<unknown> =>
      Promise.resolve({ canceled: false, filePath: target });
    // The export opens what it made; there is nothing here to open it.
    (shell as unknown as { openPath: unknown }).openPath = (): Promise<string> =>
      Promise.resolve('');
  }, file);
  await (await ribbonButton(page, 'More Print actions')).click();
  await page.getByRole('menuitem', { name: 'Export to PDF' }).click();
  // The file appears before all of it is written.
  const count: () => number = (): number =>
    fs.existsSync(file)
      ? Number(/\/Count (\d+)/.exec(fs.readFileSync(file, 'latin1'))?.[1] ?? 0)
      : 0;
  await expect.poll(count).toBeGreaterThan(0);
  return count();
}

/**
 * A document prints whole, and nothing docked around it does: on screen it is one clamped viewport, laid
 * over its dock's main group.
 */
test.describe('printing', () => {
  for (const [kind, action, view, editor] of [
    ['markdown', 'New Markdown File', 'app-markdown-view', '.ProseMirror'],
    ['code', 'New Code File', 'app-code-view', '.monaco-editor'],
  ] as const) {
    test(`${kind}_printsTheWholeDocument_andNotThePanelsAroundIt`, async ({
      app,
      page,
      scratch,
    }) => {
      await openTabFromWelcome(app, page, action, view);
      await page.locator(`${view} ${editor}`).first().click();
      for (let line: number = 0; line < LINES; line += 1) {
        await page.keyboard.type(`Line ${line}`);
        await page.keyboard.press('Enter');
      }
      const pages: number = await exportedPages(app, page, path.join(scratch, 'alone.pdf'));
      expect(pages).toBeGreaterThan(1);

      await (await ribbonButton(page, 'Agent')).click();
      const panel: Locator = page.locator(`${view} app-agent-conversation-panel`);
      await expect(panel).toBeVisible();
      expect(await exportedPages(app, page, path.join(scratch, 'agent.pdf'))).toBe(pages);

      await page.emulateMedia({ media: 'print' });
      await expect(panel).toBeHidden();
    });
  }
});
