import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openTabFromWelcome } from './helpers';

/**
 * Gets whether the suite drives a macOS build, where `Mod` is ⌘.
 */
const IS_MAC: boolean = process.platform === 'darwin';

/**
 * Holds the Playwright name of the platform's `Mod` modifier key.
 */
const MOD: string = IS_MAC ? 'Meta' : 'Control';

/**
 * Lists the selectors of Monaco's own colour picker: the one its hover showed, and its standalone one.
 */
const MONACO_PICKERS: string = '.colorpicker-widget, .standalone-colorpicker-body';

/**
 * The editor's Monaco instance, as far as the spec reads it.
 */
interface MonacoLike {
  readonly editor: {
    getEditors(): readonly {
      getModel(): { setValue(value: string): void; getValue(): string } | null;
    }[];
    setModelLanguage(model: unknown, language: string): void;
  };
}

/**
 * Gives the open code editor a language and some text, through Monaco itself.
 * @param page The main window.
 * @param language The language.
 * @param text The text.
 */
async function load(page: Page, language: string, text: string): Promise<void> {
  await page.evaluate(
    ([id, value]: readonly string[]): void => {
      const monaco: MonacoLike = (window as unknown as { monaco: MonacoLike }).monaco;
      const model: { setValue(value: string): void } | null = monaco.editor
        .getEditors()[0]
        .getModel();
      monaco.editor.setModelLanguage(model, id);
      model?.setValue(value);
    },
    [language, text],
  );
}

/**
 * Reads the open code editor's text.
 * @param page The main window.
 * @returns Returns the text.
 */
function text(page: Page): Promise<string> {
  return page.evaluate(
    (): string =>
      (window as unknown as { monaco: MonacoLike }).monaco.editor
        .getEditors()[0]
        .getModel()
        ?.getValue() ?? '',
  );
}

/**
 * Clicks the first colour swatch in the editor and waits for Studio's picker.
 * @param page The main window.
 * @returns Returns the picker.
 */
async function openPicker(page: Page): Promise<Locator> {
  const swatch: Locator = page
    .locator('app-code-view .monaco-editor .colorpicker-color-decoration')
    .first();
  await expect(swatch).toBeVisible({ timeout: 10_000 });
  await swatch.click();
  const picker: Locator = page.locator('app-colour-picker');
  await expect(picker).toBeVisible();
  expect(await page.locator(MONACO_PICKERS).count(), 'Monaco colour picker').toBe(0);
  return picker;
}

/**
 * Types a colour into the picker's hex field.
 * @param picker The picker.
 * @param colour The colour.
 */
async function typeHex(picker: Locator, colour: string): Promise<void> {
  await picker.getByRole('radio', { name: 'Hex' }).first().click();
  const field: Locator = picker.getByRole('textbox', { name: 'Hex' });
  await field.fill(colour);
}

/**
 * Clicks a colour swatch and checks Studio's picker opens (#1025), never Monaco's, writes the picked
 * colour back in the format it was written in as one undo step, and leaves the text alone on Escape.
 */
test.describe('colour picker (#1025)', () => {
  test('aSwatchClick_opensStudiosPicker_whichWritesTheColourAsWritten_asOneUndoStep', async ({
    app,
    page,
  }) => {
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    const monaco: Locator = page.locator('app-code-view .monaco-editor');
    await expect(monaco).toBeVisible();
    await monaco.locator('.view-lines').click();
    await load(page, 'css', 'a { color: #ff0000; }\n');

    // A hex code stays a hex code.
    let picker: Locator = await openPicker(page);
    await typeHex(picker, '#00ff00');
    await expect(picker.getByLabel('Written as')).toHaveText('#00ff00');
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect.poll((): Promise<string> => text(page)).toBe('a { color: #00ff00; }\n');

    // Escape leaves the text as it was.
    picker = await openPicker(page);
    await typeHex(picker, '#0000ff');
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(await text(page)).toBe('a { color: #00ff00; }\n');

    // One undo takes the whole pick back.
    await monaco.locator('.view-lines').click();
    await page.keyboard.press(`${MOD}+Z`);
    await expect.poll((): Promise<string> => text(page)).toBe('a { color: #ff0000; }\n');

    // An rgb() function stays one, gaining its alpha; Apply writes it.
    await load(page, 'css', 'a { color: rgb(255, 0, 0); }\n');
    picker = await openPicker(page);
    await typeHex(picker, '#0000ff80');
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect
      .poll((): Promise<string> => text(page))
      .toBe('a { color: rgba(0, 0, 255, 0.5); }\n');

    // The format switcher converts it.
    picker = await openPicker(page);
    await picker
      .getByRole('radiogroup', { name: 'Write as' })
      .getByRole('radio', { name: 'HSL' })
      .click();
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect
      .poll((): Promise<string> => text(page))
      .toBe('a { color: hsla(240, 100%, 50%, 0.5); }\n');
    expect(await page.locator(MONACO_PICKERS).count(), 'Monaco colour picker').toBe(0);
  });
});
