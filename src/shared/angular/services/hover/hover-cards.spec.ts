import { ApplicationRef, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock } from 'vitest';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { QuickFixes } from '@shared/angular/services/quick-fix/quick-fixes';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { HoverCardContent, MARKER_SEVERITY } from './hover-content';
import { HoverCards } from './hover-cards';

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * The model's lines.
 */
const LINES: readonly string[] = ['const greeting = hello;', '', 'greeting.toUpperCase();'];

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
  decorations: MonacoApi.editor.IModelDecoration[];
}

/**
 * Builds a stand-in editor over {@link LINES}, whose words are runs of letters, with the caret at 1:7.
 * @returns Returns the editor and its recorder.
 */
function fakeEditor(): FakeEditor {
  const calls: string[] = [];
  let caret: MonacoApi.IPosition = { lineNumber: 1, column: 7 };
  const container: HTMLElement = document.createElement('div');
  document.body.appendChild(container);
  const none: () => MonacoApi.IDisposable = (): MonacoApi.IDisposable => ({
    dispose: (): void => undefined,
  });
  const fake: FakeEditor = {
    editor: null as unknown as MonacoApi.editor.ICodeEditor,
    calls,
    decorations: [],
  };
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLanguageId: (): string => 'typescript',
    getWordAtPosition: (position: MonacoApi.IPosition): MonacoApi.editor.IWordAtPosition | null => {
      for (const match of (LINES[position.lineNumber - 1] ?? '').matchAll(/[A-Za-z]+/g)) {
        const start: number = (match.index ?? 0) + 1;
        if (position.column >= start && position.column <= start + match[0].length) {
          return { word: match[0], startColumn: start, endColumn: start + match[0].length };
        }
      }
      return null;
    },
  };
  (fake as { editor: unknown }).editor = {
    getModel: (): unknown => model,
    getPosition: (): MonacoApi.IPosition => caret,
    setPosition: (position: MonacoApi.IPosition): void => {
      caret = position;
      calls.push(`caret ${position.lineNumber}:${position.column}`);
    },
    focus: (): void => void calls.push('focus'),
    revealRangeInCenterIfOutsideViewport: (range: MonacoApi.IRange): void =>
      void calls.push(`reveal ${range.startLineNumber}:${range.startColumn}`),
    revealPositionInCenterIfOutsideViewport: (): void => undefined,
    getContainerDomNode: (): HTMLElement => container,
    getScrolledVisiblePosition: (
      position: MonacoApi.IPosition,
    ): { top: number; left: number; height: number } => ({
      top: (position.lineNumber - 1) * 20,
      left: position.column * 8,
      height: 20,
    }),
    getLayoutInfo: (): unknown => ({ glyphMarginLeft: 0, glyphMarginWidth: 18 }),
    getLineDecorations: (line: number): MonacoApi.editor.IModelDecoration[] =>
      fake.decorations.filter(
        (decoration: MonacoApi.editor.IModelDecoration): boolean =>
          decoration.range.startLineNumber === line,
      ),
    onMouseMove: none,
    onMouseLeave: none,
    onMouseDown: none,
    onKeyDown: none,
    onDidScrollChange: none,
    onDidChangeModelContent: none,
    onDidChangeModel: none,
    onDidBlurEditorWidget: none,
  };
  return fake;
}

/**
 * Builds a fake Monaco instance for the editor's window, prepared as the real one is so hover
 * providers can register, holding the given markers.
 * @param markers The markers on the model.
 * @returns Returns the instance.
 */
function fakeMonaco(markers: MonacoApi.editor.IMarker[]): typeof MonacoApi {
  const register: () => MonacoApi.IDisposable = (): MonacoApi.IDisposable => ({
    dispose: (): void => undefined,
  });
  const monaco: typeof MonacoApi = {
    editor: { getModelMarkers: (): MonacoApi.editor.IMarker[] => markers },
    languages: {
      registerDefinitionProvider: register,
      registerReferenceProvider: register,
      registerRenameProvider: register,
      registerCodeActionProvider: register,
      registerHoverProvider: register,
      registerColorProvider: register,
      setLanguageConfiguration: register,
    },
    CancellationTokenSource: class {
      public readonly token: MonacoApi.CancellationToken = {
        isCancellationRequested: false,
      } as MonacoApi.CancellationToken;
      public dispose(): void {
        // Nothing to release.
      }
    },
  } as unknown as typeof MonacoApi;
  captureEditorCapabilities(monaco);
  return monaco;
}

/**
 * Builds a problem on one line.
 * @param line The line.
 * @param start Its first column.
 * @param end The column after its last.
 * @param severity Its severity.
 * @returns Returns the problem.
 */
function marker(
  line: number,
  start: number,
  end: number,
  severity: number = MARKER_SEVERITY.error,
): MonacoApi.editor.IMarker {
  return {
    message: `problem at ${line}:${start}`,
    severity,
    startLineNumber: line,
    startColumn: start,
    endLineNumber: line,
    endColumn: end,
    source: 'ts',
  } as MonacoApi.editor.IMarker;
}

/**
 * Lets queued promises settle and renders what changed.
 * @returns Returns a promise that resolves once settled.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
  TestBed.inject(ApplicationRef).tick();
}

/**
 * Finds the card in the page.
 * @returns Returns its element, or null when none shows.
 */
function card(): HTMLElement | null {
  return document.querySelector('app-hover-card');
}

/**
 * Clicks the card's button with a label.
 * @param label The button's label.
 */
function press(label: string): void {
  const button: HTMLButtonElement | undefined = [
    ...(card()?.querySelectorAll('button') ?? []),
  ].find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
  if (button === undefined) {
    throw new Error(`No ${label} button`);
  }
  button.click();
}

describe('HoverCards (#1020)', () => {
  let markers: MonacoApi.editor.IMarker[];
  let monaco: typeof MonacoApi;
  let quickFixes: {
    offersQuickFixes: Mock<QuickFixes['offersQuickFixes']>;
    open: Mock<QuickFixes['open']>;
  };
  let navigation: {
    offersDefinitions: Mock<EditorNavigation['offersDefinitions']>;
    offersReferences: Mock<EditorNavigation['offersReferences']>;
    listsReferences: Mock<EditorNavigation['listsReferences']>;
    goToDefinition: Mock<EditorNavigation['goToDefinition']>;
    findReferences: Mock<EditorNavigation['findReferences']>;
  };
  let fake: FakeEditor;
  let cards: HoverCards;
  let detach: () => void;

  beforeEach(() => {
    markers = [marker(1, 18, 23), marker(3, 10, 21, MARKER_SEVERITY.warning)];
    monaco = fakeMonaco(markers);
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    monaco.languages.registerHoverProvider('typescript', {
      provideHover: (): MonacoApi.languages.Hover => ({
        contents: [{ value: 'const greeting: string' }, { value: 'The <b>greeting</b>.' }],
      }),
    });
    monaco.languages.registerHoverProvider('typescript', {
      provideHover: (): MonacoApi.languages.Hover => ({
        contents: [{ value: 'const greeting: string' }],
      }),
    });
    quickFixes = {
      offersQuickFixes: vi.fn<QuickFixes['offersQuickFixes']>((): boolean => true),
      open: vi.fn<QuickFixes['open']>((): Promise<void> => Promise.resolve()),
    };
    navigation = {
      offersDefinitions: vi.fn<EditorNavigation['offersDefinitions']>((): boolean => true),
      offersReferences: vi.fn<EditorNavigation['offersReferences']>((): boolean => true),
      listsReferences: vi.fn<EditorNavigation['listsReferences']>((): boolean => false),
      goToDefinition: vi.fn<EditorNavigation['goToDefinition']>((): Promise<void> =>
        Promise.resolve(),
      ),
      findReferences: vi.fn<EditorNavigation['findReferences']>((): Promise<void> =>
        Promise.resolve(),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: QuickFixes, useValue: quickFixes },
        { provide: EditorNavigation, useValue: navigation },
      ],
    });
    cards = TestBed.inject(HoverCards);
    fake = fakeEditor();
    detach = cards.attach(fake.editor, TestBed.inject(Injector));
  });

  afterEach(() => {
    detach();
    delete (window as unknown as { monaco?: unknown }).monaco;
    document.body.innerHTML = '';
  });

  it('contentAt_mergesEveryProvider_showingADuplicateOnce_withTheSpotsProblemsAndActions', async () => {
    const content: HoverCardContent | null = await cards.contentAt(fake.editor, {
      kind: 'text',
      position: { lineNumber: 1, column: 20 },
      anchor: { startLineNumber: 1, startColumn: 18, endLineNumber: 1, endColumn: 23 },
    });

    expect(content).toEqual({
      sections: ['const greeting: string', 'The &lt;b>greeting&lt;/b>.'],
      problems: [
        {
          message: 'problem at 1:18',
          severity: MARKER_SEVERITY.error,
          source: 'ts',
          code: null,
          range: { startLineNumber: 1, startColumn: 18, endLineNumber: 1, endColumn: 23 },
        },
      ],
      quickFix: true,
      actions: { definition: true, references: true, referencesListed: false },
    });
  });

  it('contentAt_offTheWords_hasNoActions_andTheGutterShowsItsDescriptionsAlone', async () => {
    fake.decorations = [
      {
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
        options: { glyphMarginHoverMessage: { value: 'Conditional breakpoint: x > 1' } },
      } as MonacoApi.editor.IModelDecoration,
    ];

    const blank: HoverCardContent | null = await cards.contentAt(fake.editor, {
      kind: 'text',
      position: { lineNumber: 2, column: 1 },
      anchor: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
    });
    const gutter: HoverCardContent | null = await cards.contentAt(fake.editor, {
      kind: 'gutter',
      position: { lineNumber: 2, column: 1 },
      anchor: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
    });

    expect(blank?.actions).toBeNull();
    expect(blank?.quickFix).toBe(false);
    expect(gutter).toEqual({
      sections: ['Conditional breakpoint: x > 1'],
      problems: [],
      quickFix: false,
      actions: null,
    });
  });

  it('showAt_drawsTheCardAtTheCaret_inAnOverlay_withNoMonacoHover', async () => {
    cards.showAt(fake.editor);
    await settle();

    expect(card()).not.toBeNull();
    expect(card()?.textContent).toContain('const greeting: string');
    expect(card()?.closest('.cdk-overlay-pane')?.classList).toContain('hover-card-overlay');
    expect(document.querySelector('.cdk-overlay-backdrop')).toBeNull();
    expect(document.querySelector('.monaco-hover')).toBeNull();
  });

  it('goToProblem_movesTheCaretToTheNextProblem_andShowsItsCard_thenWrapsBackwards', async () => {
    cards.goToProblem(fake.editor, 'next');
    await settle();

    expect(fake.calls).toEqual(['caret 1:18', 'reveal 1:18']);
    expect(card()?.textContent).toContain('problem at 1:18');

    fake.calls.length = 0;
    cards.goToProblem(fake.editor, 'previous');
    await settle();
    expect(fake.calls).toEqual(['caret 3:10', 'reveal 3:10']);
    expect(card()?.textContent).toContain('problem at 3:10');
    expect(document.querySelectorAll('app-hover-card')).toHaveLength(1);
  });

  it('quickFix_movesTheCaretToTheProblem_thenOpensStudiosFixesMenu', async () => {
    cards.goToProblem(fake.editor, 'previous');
    await settle();
    fake.calls.length = 0;

    press('Quick Fix…');

    expect(card()).toBeNull();
    expect(fake.calls).toEqual(['caret 3:10', 'focus']);
    expect(quickFixes.open).toHaveBeenCalledWith(fake.editor);
  });

  it('goToProblem_fromTheCard_movesTheCaretAndRevealsIt', async () => {
    cards.showAt(fake.editor, { lineNumber: 1, column: 20 });
    await settle();
    fake.calls.length = 0;

    press('Go to Problem');

    expect(card()).toBeNull();
    expect(fake.calls).toEqual(['caret 1:18', 'reveal 1:18', 'focus']);
  });

  it('theActionsRow_goesToTheDefinition_orListsReferences_fromTheSymbol', async () => {
    cards.showAt(fake.editor, { lineNumber: 3, column: 3 });
    await settle();
    fake.calls.length = 0;
    press('Go to Definition');

    expect(fake.calls).toEqual(['caret 3:3', 'focus']);
    expect(navigation.goToDefinition).toHaveBeenCalledWith(fake.editor);
    expect(card()).toBeNull();

    navigation.listsReferences.mockReturnValue(true);
    cards.showAt(fake.editor, { lineNumber: 1, column: 9 });
    await settle();
    press('Find All References');
    expect(navigation.findReferences).toHaveBeenCalledWith(fake.editor);
  });

  it('findAllReferences_isInert_whereNoPanelListsThem_andTheQuickFixIsHiddenWhereNoneIsOffered', async () => {
    quickFixes.offersQuickFixes.mockReturnValue(false);
    cards.showAt(fake.editor, { lineNumber: 1, column: 20 });
    await settle();

    const references: HTMLButtonElement | undefined = [
      ...(card()?.querySelectorAll('button') ?? []),
    ].find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Find All References',
    );
    expect(references?.disabled).toBe(true);
    expect(card()?.textContent).not.toContain('Quick Fix');
  });

  it('escapeInTheCard_closesIt_andGivesTheEditorFocusBack', async () => {
    cards.showAt(fake.editor);
    await settle();
    fake.calls.length = 0;

    card()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(card()).toBeNull();
    expect(fake.calls).toEqual(['focus']);
  });

  it('anEditorNobodyAttached_isLeftAlone', async () => {
    const stranger: FakeEditor = fakeEditor();

    cards.showAt(stranger.editor);
    cards.goToProblem(stranger.editor, 'next');
    await settle();

    expect(card()).toBeNull();
  });

  it('detach_takesTheCardAway', async () => {
    cards.showAt(fake.editor);
    await settle();

    detach();
    await settle();

    expect(card()).toBeNull();
  });
});
