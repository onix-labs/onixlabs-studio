import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { isModalWindow, openTabFromWelcome } from './helpers';

/**
 * Gets whether the suite drives a macOS build, where `Mod` is ⌘ and a few chords differ.
 */
const IS_MAC: boolean = process.platform === 'darwin';

/**
 * Holds the Playwright name of the platform's `Mod` modifier key.
 */
const MOD: string = IS_MAC ? 'Meta' : 'Control';

/**
 * Lists every Monaco command whose chord opens Monaco-drawn UI: a copy of `MONACO_WIDGET_COMMANDS`
 * (`src/shared/angular/services/monaco/monaco-widget-guard.ts`), which the guard's contract spec checks
 * against Monaco's build. Copied rather than imported: the end-to-end suite compiles on its own.
 */
const MONACO_WIDGET_COMMANDS: readonly string[] = [
  'actions.find',
  'actions.findWithSelection',
  'editor.actions.findWithArgs',
  'editor.action.startFindReplaceAction',
  'editor.action.nextMatchFindAction',
  'editor.action.previousMatchFindAction',
  'editor.action.nextSelectionMatchFindAction',
  'editor.action.previousSelectionMatchFindAction',
  'editor.action.goToMatchFindAction',
  'editor.action.replaceOne',
  'editor.action.replaceAll',
  'editor.action.selectAllMatches',
  'closeFindWidget',
  'toggleFindCaseSensitive',
  'toggleFindWholeWord',
  'toggleFindRegex',
  'toggleFindInSelection',
  'togglePreserveCase',
  'editor.action.quickCommand',
  'editor.action.quickOutline',
  'editor.action.gotoLine',
  'editor.action.gotoOffset',
  'editor.action.revealDefinition',
  'editor.action.revealDefinitionAside',
  'editor.action.peekDefinition',
  'editor.action.revealDeclaration',
  'editor.action.peekDeclaration',
  'editor.action.goToTypeDefinition',
  'editor.action.peekTypeDefinition',
  'editor.action.goToImplementation',
  'editor.action.peekImplementation',
  'editor.action.goToReferences',
  'editor.action.referenceSearch.trigger',
  'editor.action.rename',
  'editor.action.quickFix',
  'editor.action.codeAction',
  'editor.action.refactor',
  'editor.action.sourceAction',
  'editor.action.organizeImports',
  'editor.action.autoFix',
  'editor.action.fixAll',
  'editor.action.showHover',
  'editor.action.marker.next',
  'editor.action.marker.prev',
  'editor.action.marker.nextInFiles',
  'editor.action.marker.prevInFiles',
  'editor.action.triggerSuggest',
  'editor.action.triggerParameterHints',
  'editor.action.showContextMenu',
  'workbench.action.showHover',
  'editor.action.accessibleDiffViewer.next',
  'editor.action.accessibleDiffViewer.prev',
  'editor.action.inlineSuggest.trigger',
  'editor.action.inlineSuggest.showNext',
  'editor.action.inlineSuggest.showPrevious',
  'editor.changePasteType',
  'editor.changeDropType',
  'editor.action.showOrFocusStandaloneColorPicker',
  'editor.action.showDefinitionPreviewHover',
  'editor.action.inspectTokens',
  'editor.action.showReferences',
  'editor.action.peekLocations',
  'editor.action.showAccessibilityHelp',
  'editor.action.accessibilityHelp',
  'editor.action.accessibleView',
];

/**
 * Matches every piece of Monaco-drawn UI Studio has replaced (#946): the hover, the suggest list and
 * signature card, find and its options strip, quick input, peeks, the rename box, the right-click
 * menu, the lightbulb, both colour pickers, the accessibility help and accessible view, the token
 * inspector, and inline suggestions and edits with their toolbar.
 */
const MONACO_WIDGETS: string = [
  '.monaco-hover',
  '.suggest-widget',
  '.parameter-hints-widget',
  '.find-widget',
  '.findOptionsWidget',
  '.quick-input-widget',
  '.peekview-widget',
  '.rename-box',
  '.context-view .monaco-menu',
  '.lightBulbWidget',
  '.colorpicker-widget',
  '.standalone-colorpicker-body',
  '.accessibilityHelpWidget',
  '.accessible-view',
  '.tokens-inspect-widget',
  '.inline-edits',
  '.inlineSuggestionsHints',
].join(', ');

/**
 * Lists the chords pressed in the editor, each a sequence of Playwright key presses: every chord
 * Monaco 0.57 binds to a command that opens its UI, on this platform, and the ones Studio has taken
 * over in their place. Chords the shell or the operating system owns (⌘H, ⌘M, ⌘Q, ⌘W, ⌘S and the
 * like) are left out: they never reach the editor.
 */
const CHORDS: readonly (readonly string[])[] = [
  // Find, and the multi-cursor chords that flash the find options.
  [`${MOD}+F`],
  [IS_MAC ? 'Meta+Alt+F' : 'Control+H'],
  ['F3'],
  ['Shift+F3'],
  [`${MOD}+F3`],
  [IS_MAC ? 'Meta+G' : 'F3'],
  [IS_MAC ? 'Meta+E' : 'Control+F3'],
  ['Alt+Enter'],
  [`${MOD}+D`],
  [`${MOD}+K`, `${MOD}+D`],
  [`${MOD}+Shift+L`],
  [`${MOD}+F2`],
  // The command palette, go to symbol, go to line.
  ['F1'],
  [`${MOD}+Shift+O`],
  ['Control+G'],
  // Navigation and peeks.
  ['F12'],
  ['Shift+F12'],
  ['Alt+F12'],
  [`${MOD}+F12`],
  [`${MOD}+Shift+F12`],
  [`${MOD}+K`, 'F12'],
  ['Alt+Shift+F12'],
  // Rename, code actions, problems, hover.
  ['F2'],
  [`${MOD}+.`],
  ['Control+Shift+R'],
  ['Alt+Shift+O'],
  ['Alt+Shift+.'],
  ['F8'],
  ['Shift+F8'],
  ['Alt+F8'],
  ['Alt+Shift+F8'],
  [`${MOD}+K`, `${MOD}+I`],
  // Suggest and parameter hints.
  ['Control+Space'],
  [`${MOD}+I`],
  ...(IS_MAC ? [['Alt+Escape']] : []),
  [`${MOD}+Shift+Space`],
  // The right-click menu, accessibility help, inline suggestions, diffs.
  ['Shift+F10'],
  ['Alt+F1'],
  ['Alt+]'],
  ['Alt+['],
  ['F7'],
  ['Shift+F7'],
];

/**
 * Counts the Monaco-drawn UI in a window.
 * @param page The window.
 * @returns Returns how many pieces of Monaco's UI are in its document.
 */
function monacoWidgets(page: Page): Promise<number> {
  return page.locator(MONACO_WIDGETS).count();
}

/**
 * Closes whatever Studio opened in answer to a chord — a panel, a menu, a dialog in a window of its own
 * — so the next chord starts in the editor again.
 * @param app The application.
 * @param page The main window.
 * @param before The modal windows open before the chord, which are left alone.
 */
async function settle(
  app: ElectronApplication,
  page: Page,
  before: readonly Page[],
): Promise<void> {
  for (const window of app.windows().filter(isModalWindow)) {
    if (!before.includes(window)) {
      await window.keyboard.press('Escape').catch((): void => undefined);
      if (isModalWindow(window)) {
        await window.close().catch((): void => undefined);
      }
    }
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/**
 * Puts the caret of the open code editor at a position and gives the editor the keyboard.
 * @param page The main window.
 * @param lineNumber The line, one-based.
 * @param column The column, one-based.
 */
async function caretAt(page: Page, lineNumber: number, column: number): Promise<void> {
  await page.evaluate(
    ([line, at]: readonly number[]): void => {
      const editor: ReturnType<MonacoLike['editor']['getEditors']>[number] = (
        window as unknown as { monaco: MonacoLike }
      ).monaco.editor.getEditors()[0];
      editor.setPosition({ lineNumber: line, column: at });
      editor.focus();
    },
    [lineNumber, column],
  );
}

/**
 * The editor's Monaco instance, as far as the specs read it: its editors, their models and their
 * keybinding service.
 */
interface MonacoLike {
  readonly editor: {
    getEditors(): readonly {
      getModel(): { setValue(value: string): void; getValue(): string } | null;
      updateOptions(options: Record<string, unknown>): void;
      setPosition(position: { lineNumber: number; column: number }): void;
      getSelections(): readonly { toString(): string }[] | null;
      focus(): void;
      getAction(id: string): { run(): Promise<void> } | null;
      readonly _standaloneKeybindingService: {
        _getResolver(): {
          getKeybindings(): readonly {
            readonly command: string | null;
            readonly resolvedKeybinding: unknown;
          }[];
        };
      };
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
      const editor: ReturnType<MonacoLike['editor']['getEditors']>[number] =
        monaco.editor.getEditors()[0];
      const model: { setValue(value: string): void } | null = editor.getModel();
      monaco.editor.setModelLanguage(model, id);
      model?.setValue(value);
    },
    [language, text],
  );
}

/**
 * Presses every chord of Monaco's that once opened its UI in a code editor — and right-clicks, and
 * clicks a colour swatch (which opens Studio's picker), and runs Code Cleanup's organise-imports route — and checks that no Monaco
 * widget ever appears (#1024). Studio's own UI opening in answer is expected, and closed between
 * chords.
 */
test.describe('editor widgets (#1024)', () => {
  test('theReplacementsAnswer_selectionChordsSelect_andShiftF10OpensStudiosMenu', async ({
    app,
    page,
  }) => {
    // #1034: the guard proves no Monaco widget opens; this proves Studio's answers actually come.
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    const monaco: Locator = page.locator('app-code-view .monaco-editor');
    await expect(monaco).toBeVisible();
    await monaco.locator('.view-lines').click();
    await load(
      page,
      'typescript',
      ['const value = 1;', 'const other = value + value;', 'const third = value * 2;'].join('\n'),
    );
    const selections: () => Promise<readonly string[]> = (): Promise<readonly string[]> =>
      page.evaluate((): readonly string[] =>
        (
          (window as unknown as { monaco: MonacoLike }).monaco.editor
            .getEditors()[0]
            .getSelections() ?? []
        ).map((selection: { toString(): string }): string => selection.toString()),
      );
    const caretInValue: () => Promise<void> = (): Promise<void> =>
      page.evaluate((): void => {
        const editor: ReturnType<MonacoLike['editor']['getEditors']>[number] = (
          window as unknown as { monaco: MonacoLike }
        ).monaco.editor.getEditors()[0];
        editor.focus();
        editor.setPosition({ lineNumber: 1, column: 9 });
      });
    const mod: string = process.platform === 'darwin' ? 'Meta' : 'Control';

    // ⌘D (Ctrl+D) selects the word, then adds its next occurrence.
    await caretInValue();
    await page.keyboard.press(`${mod}+D`);
    await page.keyboard.press(`${mod}+D`);
    await expect.poll(selections).toEqual(['[1,7 -> 1,12]', '[2,15 -> 2,20]']);

    // ⌘⇧L (Ctrl+Shift+L) selects every occurrence.
    await caretInValue();
    await page.keyboard.press(`${mod}+Shift+L`);
    await expect.poll(async (): Promise<number> => (await selections()).length).toBe(4);
    await expect(page.locator('.find-widget')).toHaveCount(0);

    // ⇧F10 opens Studio's right-click menu at the caret.
    await caretInValue();
    await page.keyboard.press('Shift+F10');
    await expect(
      page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Go to Symbol' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('noChordClickOrCleanup_opensMonacosOwnUI', async ({ app, page }) => {
    test.setTimeout(180_000);
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    const monaco: Locator = page.locator('app-code-view .monaco-editor');
    const text: Locator = monaco.locator('.view-lines');
    await expect(monaco).toBeVisible();
    await text.click();
    await page.keyboard.type('const answer = 42;');
    await load(
      page,
      'typescript',
      [
        "import { b, a } from './nowhere';",
        'function greet(name: string): string {',
        '  return `Hello, ${name}`;',
        '}',
        'const answer: number = greet(42);',
        'answer.toFixed(',
      ].join('\n'),
    );

    // The running editor's own keybinding service: no audited command keeps a chord.
    const stillBound: readonly string[] = await page.evaluate(
      (commands: readonly string[]): readonly string[] =>
        (window as unknown as { monaco: MonacoLike }).monaco.editor
          .getEditors()[0]
          ._standaloneKeybindingService._getResolver()
          .getKeybindings()
          .filter(
            (binding: { readonly command: string | null; readonly resolvedKeybinding: unknown }) =>
              binding.resolvedKeybinding !== undefined &&
              binding.resolvedKeybinding !== null &&
              binding.command !== null &&
              commands.includes(binding.command),
          )
          .map((binding: { readonly command: string | null }): string => binding.command ?? ''),
      [...MONACO_WIDGET_COMMANDS],
    );
    expect(stillBound).toEqual([]);

    const before: readonly Page[] = app.windows().filter(isModalWindow);
    for (const chord of CHORDS) {
      // On `greet` in `greet(42)`, where most of the chords have something to act on.
      await caretAt(page, 5, 26);
      for (const key of chord) {
        await page.keyboard.press(key);
      }
      await page.waitForTimeout(400);
      expect(await monacoWidgets(page), chord.join(' ')).toBe(0);
      await settle(app, page, before);
    }

    // Typing a member access and a call: Studio's list and card, never Monaco's.
    await caretAt(page, 6, 17);
    await page.keyboard.type('2);\ngreet.');
    await page.waitForTimeout(600);
    expect(await monacoWidgets(page), 'typing').toBe(0);
    await settle(app, page, before);

    // A right-click on the text opens Studio's menu.
    await text.click({ button: 'right' });
    await page.waitForTimeout(400);
    expect(await monacoWidgets(page), 'right-click').toBe(0);
    await settle(app, page, before);

    // Code Cleanup's first step: Monaco's organise imports, applied without Monaco's lightbulb or
    // overlay message.
    await page.evaluate(async (): Promise<void> => {
      await (window as unknown as { monaco: MonacoLike }).monaco.editor
        .getEditors()[0]
        .getAction('editor.action.organizeImports')
        ?.run();
    });
    await page.waitForTimeout(1_000);
    expect(await monacoWidgets(page), 'organise imports').toBe(0);
    expect(await page.locator('.monaco-editor-overlaymessage').count(), 'overlay message').toBe(0);

    // A colour swatch: a decoration, whose click opens Studio's colour picker (#1025).
    await load(page, 'css', 'a {\n  color: #ff0000;\n}\n');
    const swatch: Locator = monaco.locator('.colorpicker-color-decoration').first();
    await expect(swatch).toBeVisible({ timeout: 10_000 });
    await swatch.click();
    await expect(page.locator('app-colour-picker')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await monacoWidgets(page), 'colour swatch').toBe(0);
    await page.keyboard.press('Escape');
  });

  test('aReadOnlyEdit_andUnusualLineTerminators_askStudio_neverMonacoOrTheBrowser', async ({
    app,
    page,
  }) => {
    // Monaco asked about unusual line terminators in the browser's confirm box.
    const browserDialogs: string[] = [];
    page.on('dialog', (dialog: { message(): string; dismiss(): Promise<void> }): void => {
      browserDialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openTabFromWelcome(app, page, 'New Code File', 'app-code-view');
    const monaco: Locator = page.locator('app-code-view .monaco-editor');
    await expect(monaco).toBeVisible();
    await monaco.locator('.view-lines').click();

    // Typing into a read-only editor: Studio's brief notice, never Monaco's overlay message.
    await page.evaluate((): void =>
      (window as unknown as { monaco: MonacoLike }).monaco.editor
        .getEditors()[0]
        .updateOptions({ readOnly: true }),
    );
    await caretAt(page, 1, 1);
    await page.keyboard.type('abc');
    await expect(
      page.locator('app-toast-card', { hasText: 'This editor is read-only' }),
    ).toHaveCount(1);
    expect(await page.locator('.monaco-editor-overlaymessage').count(), 'overlay message').toBe(0);
    await page.evaluate((): void =>
      (window as unknown as { monaco: MonacoLike }).monaco.editor
        .getEditors()[0]
        .updateOptions({ readOnly: false }),
    );

    // A Line Separator in the text: Studio's dialog asks, and removing them removes them.
    const before: readonly Page[] = app.windows().filter(isModalWindow);
    await load(page, 'plaintext', 'one\u2028two');
    const dialog: Page = await app.waitForEvent('window', {
      predicate: (window: Page): boolean => isModalWindow(window) && !before.includes(window),
    });
    await expect(dialog.getByText('Remove unusual line terminators?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove Them' }).click();
    await expect
      .poll((): Promise<string> =>
        page.evaluate(
          (): string =>
            (window as unknown as { monaco: MonacoLike }).monaco.editor
              .getEditors()[0]
              .getModel()
              ?.getValue() ?? '',
        ),
      )
      .toBe('onetwo');
    expect(browserDialogs).toEqual([]);
    expect(await monacoWidgets(page)).toBe(0);
  });
});
