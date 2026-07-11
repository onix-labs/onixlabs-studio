import { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome } from './helpers';

/**
 * Editing flows: typing into the markdown (Milkdown/ProseMirror) and code (Monaco) editors and
 * observing the document react — word count, caret position, and buffer content.
 */
test.describe('editing', () => {
  test('markdownEditor_typing_updatesTheWordCount', async ({ page }) => {
    await openTabFromWelcome(page, 'New Markdown File', 'app-markdown-view');
    const editor: Locator = page.locator('app-markdown-view .ProseMirror[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(page.locator('app-status-strip-container')).toContainText('0 words');

    await editor.click();
    await page.keyboard.type('hello brave new world');

    await expect(page.locator('app-status-strip-container')).toContainText('4 words');
    await expect(editor).toContainText('hello brave new world');
  });

  test('codeEditor_typing_updatesBufferAndCaretPosition', async ({ page }) => {
    await openTabFromWelcome(page, 'New Code File', 'app-code-view');
    const monaco: Locator = page.locator('app-code-view .monaco-editor');
    await expect(monaco).toBeVisible();
    await expect(page.locator('app-status-strip-container')).toContainText('Ln 1');

    await monaco.locator('.view-lines').click();
    await page.keyboard.type('const answer = 42;');

    await expect(monaco.locator('.view-lines')).toContainText('const answer = 42;');
    await expect(page.locator('app-status-strip-container')).toContainText('Col 19');
  });
});
