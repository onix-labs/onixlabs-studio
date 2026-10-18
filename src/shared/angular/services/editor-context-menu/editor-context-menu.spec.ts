import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock, MockInstance } from 'vitest';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import { Editors } from '@shared/angular/services/editors/editors';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { LspDefinition, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { Studio } from '@shared/angular/services/studio/studio';
import {
  EditorContextMenu,
  EditorContextMenuOpener,
  EditorContextMenuSubject,
} from './editor-context-menu';

/**
 * Monaco's `EditorOption.readOnly`, as the fake instance numbers it.
 */
const READ_ONLY_OPTION: number = 104;

/**
 * Monaco's mouse-target types the specs click on.
 */
const TARGET: Readonly<Record<'text' | 'empty' | 'lineNumbers', number>> = {
  text: 6,
  empty: 7,
  lineNumbers: 3,
};

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * Describes the editor a spec builds.
 */
interface EditorSetup {
  readonly language?: string;
  readonly readOnly?: boolean;
  readonly selection?: MonacoApi.IRange | null;
  readonly supported?: readonly string[];
}

/**
 * A stand-in editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
  readonly edits: { range: MonacoApi.IRange; text: string }[];
  rightClick(type: number, position: MonacoApi.IPosition | null): MouseEvent;
  listening(): boolean;
}

/**
 * Builds a selection over a range, answering as Monaco's does.
 * @param range The range.
 * @returns Returns the selection.
 */
function selectionOver(range: MonacoApi.IRange): MonacoApi.Selection {
  const before: (a: MonacoApi.IPosition, b: MonacoApi.IPosition) => boolean = (
    a: MonacoApi.IPosition,
    b: MonacoApi.IPosition,
  ): boolean =>
    a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
  const start: MonacoApi.IPosition = {
    lineNumber: range.startLineNumber,
    column: range.startColumn,
  };
  const end: MonacoApi.IPosition = { lineNumber: range.endLineNumber, column: range.endColumn };
  return {
    ...range,
    isEmpty: (): boolean => before(end, start),
    containsPosition: (position: MonacoApi.IPosition): boolean =>
      before(start, position) && before(position, end),
  } as unknown as MonacoApi.Selection;
}

/**
 * Builds a stand-in Monaco editor.
 * @param setup What the editor is.
 * @returns Returns the editor and its recorders.
 */
function fakeEditor(setup: EditorSetup = {}): FakeEditor {
  const calls: string[] = [];
  const edits: { range: MonacoApi.IRange; text: string }[] = [];
  let listener: ((event: MonacoApi.editor.IEditorMouseEvent) => void) | null = null;
  let selection: MonacoApi.Selection = selectionOver(
    setup.selection ?? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
  );
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLanguageId: (): string => setup.language ?? 'typescript',
  };
  const container: HTMLElement = document.createElement('div');
  const editor: unknown = {
    getModel: (): unknown => model,
    getContainerDomNode: (): HTMLElement => container,
    getOption: (id: number): unknown =>
      id === READ_ONLY_OPTION ? setup.readOnly === true : undefined,
    getRawOptions: (): MonacoApi.editor.IEditorOptions => ({ readOnly: setup.readOnly === true }),
    getSelection: (): MonacoApi.Selection => selection,
    getPosition: (): MonacoApi.IPosition => ({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    }),
    setPosition: (position: MonacoApi.IPosition): void => {
      calls.push(`position ${position.lineNumber}:${position.column}`);
      selection = selectionOver({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
    },
    revealPositionInCenter: (position: MonacoApi.IPosition): void =>
      void calls.push(`centre ${position.lineNumber}:${position.column}`),
    layout: (): void => undefined,
    focus: (): void => void calls.push('focus'),
    trigger: (_source: string, action: string): void => void calls.push(`trigger ${action}`),
    getAction: (id: string): MonacoApi.editor.IEditorAction | null => ({
      id,
      label: id,
      alias: id,
      metadata: undefined,
      isSupported: (): boolean => (setup.supported ?? []).includes(id),
      run: (): Promise<void> => {
        calls.push(`run ${id}`);
        return Promise.resolve();
      },
    }),
    executeEdits: (
      _source: string,
      operations: { range: MonacoApi.IRange; text: string }[],
    ): boolean => {
      edits.push(...operations.map(({ range, text }) => ({ range, text })));
      return true;
    },
    onContextMenu: (
      handler: (event: MonacoApi.editor.IEditorMouseEvent) => void,
    ): MonacoApi.IDisposable => {
      listener = handler;
      return { dispose: (): void => void (listener = null) };
    },
  };
  return {
    editor: editor as MonacoApi.editor.ICodeEditor,
    calls,
    edits,
    rightClick: (type: number, position: MonacoApi.IPosition | null): MouseEvent => {
      const browserEvent: MouseEvent = new MouseEvent('contextmenu', { clientX: 40, clientY: 60 });
      listener?.({
        event: { browserEvent },
        target: { type, position },
      } as unknown as MonacoApi.editor.IEditorMouseEvent);
      return browserEvent;
    },
    listening: (): boolean => listener !== null,
  };
}

/**
 * Builds a fake Monaco instance for the editor's window, prepared as the real one is, so definition
 * providers and comment rules can be registered with it.
 * @returns Returns the instance.
 */
function fakeMonaco(): typeof MonacoApi {
  const monaco: typeof MonacoApi = {
    editor: { EditorOption: { readOnly: READ_ONLY_OPTION } },
    languages: {
      registerDefinitionProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      setLanguageConfiguration: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
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
 * Lists the identifiers of the rows, separators as `|`.
 * @param items The rows.
 * @returns Returns the identifiers.
 */
function idsOf(items: readonly MenuItem[]): string[] {
  return items.map((item: MenuItem): string => (item.separator === true ? '|' : item.id));
}

/**
 * Finds a row by identifier.
 * @param items The rows.
 * @param id The identifier.
 * @returns Returns the row.
 */
function rowOf(items: readonly MenuItem[], id: string): MenuItem | undefined {
  return items.find((item: MenuItem): boolean => item.id === id);
}

describe('EditorContextMenu (#1012)', () => {
  let monaco: typeof MonacoApi;
  let lsp: {
    servesDocument: Mock<LspFeatures['servesDocument']>;
    definitions: Mock<LspFeatures['definitions']>;
  };
  let opener: { openPath: Mock<(path: string) => Promise<boolean>> };

  /**
   * Builds the service on the given platform.
   * @param platform The host platform.
   * @returns Returns the service.
   */
  function build(platform: string = 'darwin'): EditorContextMenu {
    TestBed.configureTestingModule({
      providers: [
        { provide: Studio, useValue: { platform } },
        { provide: LspFeatures, useValue: lsp },
      ],
    });
    const menu: EditorContextMenu = TestBed.inject(EditorContextMenu);
    menu.useFileOpener(opener.openPath);
    return menu;
  }

  beforeEach(() => {
    monaco = fakeMonaco();
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    lsp = {
      servesDocument: vi.fn<LspFeatures['servesDocument']>((): boolean => false),
      definitions: vi.fn<LspFeatures['definitions']>((): Promise<readonly LspDefinition[] | null> =>
        Promise.resolve(null),
      ),
    };
    opener = {
      openPath: vi.fn<(path: string) => Promise<boolean>>((): Promise<boolean> =>
        Promise.resolve(true),
      ),
    };
  });

  afterEach(() => {
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  describe('rows', () => {
    it('writable_withEverySupport_groupsNavigationFindEditingAndClipboard_withHints', () => {
      const menu: EditorContextMenu = build('darwin');
      monaco.languages.registerDefinitionProvider('typescript', { provideDefinition: () => null });
      monaco.languages.setLanguageConfiguration('typescript', { comments: { lineComment: '//' } });
      const { editor } = fakeEditor({
        selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        supported: ['editor.action.formatDocument', 'editor.action.formatSelection'],
      });
      TestBed.inject(FindRouter).attach(editor, { host: { openFind: (): void => undefined } });

      const items: readonly MenuItem[] = menu.itemsFor(editor);

      expect(idsOf(items)).toEqual([
        'definition',
        'symbol',
        'line',
        '|',
        'find',
        '|',
        'formatDocument',
        'formatSelection',
        'comment',
        '|',
        'cut',
        'copy',
        'paste',
        'selectAll',
      ]);
      expect(items.every((item: MenuItem): boolean => item.disabled !== true)).toBe(true);
      expect(rowOf(items, 'symbol')).toMatchObject({ label: 'Go to Symbol…', shortcut: '⌘⇧O' });
      expect(rowOf(items, 'line')?.shortcut).toBe('⌃G');
      expect(rowOf(items, 'copy')?.shortcut).toBe('⌘C');
    });

    it('readOnly_offersCopyAndSelectAllAlone_andHidesFormatAndComment', () => {
      const menu: EditorContextMenu = build();
      monaco.languages.setLanguageConfiguration('typescript', { comments: { lineComment: '//' } });
      const { editor } = fakeEditor({
        readOnly: true,
        supported: ['editor.action.formatDocument', 'editor.action.formatSelection'],
      });

      expect(idsOf(menu.itemsFor(editor))).toEqual([
        'symbol',
        'line',
        '|',
        'find',
        '|',
        'copy',
        'selectAll',
      ]);
    });

    it('goToDefinition_shownWhenAProviderServesTheLanguage_orAServerTheDocument', () => {
      const menu: EditorContextMenu = build();
      const { editor } = fakeEditor({ language: 'csharp' });

      expect(rowOf(menu.itemsFor(editor), 'definition')).toBeUndefined();
      lsp.servesDocument.mockReturnValue(true);
      expect(rowOf(menu.itemsFor(editor), 'definition')?.label).toBe('Go to Definition');
      lsp.servesDocument.mockReturnValue(false);
      monaco.languages.registerDefinitionProvider('csharp', { provideDefinition: () => null });
      expect(rowOf(menu.itemsFor(editor), 'definition')).toBeDefined();
    });

    it('find_disabledWhereNothingAnswers_andFormatSelection_withNothingSelected', () => {
      const menu: EditorContextMenu = build();
      const { editor } = fakeEditor({ supported: ['editor.action.formatSelection'] });

      const items: readonly MenuItem[] = menu.itemsFor(editor);

      expect(rowOf(items, 'find')?.disabled).toBe(true);
      expect(rowOf(items, 'formatSelection')?.disabled).toBe(true);
    });

    it('toggleComment_hiddenForALanguageWithNoCommentRule', () => {
      const menu: EditorContextMenu = build();
      const { editor } = fakeEditor({ language: 'plaintext' });

      expect(rowOf(menu.itemsFor(editor), 'comment')).toBeUndefined();
    });

    it('shortcutHints_followThePlatform', () => {
      const { editor } = fakeEditor({ supported: ['editor.action.formatDocument'] });

      const windows: readonly MenuItem[] = build('win32').itemsFor(editor);
      expect(rowOf(windows, 'symbol')?.shortcut).toBe('Ctrl+Shift+O');
      expect(rowOf(windows, 'formatDocument')?.shortcut).toBe('Shift+Alt+F');
      TestBed.resetTestingModule();
      const linux: readonly MenuItem[] = build('linux').itemsFor(editor);
      expect(rowOf(linux, 'formatDocument')?.shortcut).toBe('Ctrl+Shift+I');
      expect(rowOf(linux, 'paste')?.shortcut).toBe('Ctrl+V');
    });

    it('editingChords_areHintsOnly_neverBoundAsAccelerators', () => {
      // The editing-chords rule: a Studio menu never binds ⌘Z/⌘X/⌘C/⌘V/⌘A. The rows carry the chord as
      // text, and attaching, right-clicking and building rows register nothing with the keybindings.
      const menu: EditorContextMenu = build();
      const keybindings: Keybindings = TestBed.inject(Keybindings);
      const register: MockInstance<Keybindings['register']> = vi.spyOn(keybindings, 'register');
      const registerGlobal: MockInstance<Keybindings['registerGlobal']> = vi.spyOn(
        keybindings,
        'registerGlobal',
      );
      const contribute: MockInstance<Keybindings['contribute']> = vi.spyOn(
        keybindings,
        'contribute',
      );
      const fake: FakeEditor = fakeEditor();
      const opened: EditorContextMenuSubject[] = [];
      menu.attach(fake.editor, { open: (_e, subject) => void opened.push(subject) });

      fake.rightClick(TARGET.text, { lineNumber: 1, column: 1 });

      const clipboard: readonly MenuItem[] = opened[0].items.filter((item: MenuItem): boolean =>
        ['cut', 'copy', 'paste', 'selectAll'].includes(item.id),
      );
      expect(clipboard.map((item: MenuItem): string | undefined => item.shortcut)).toEqual([
        '⌘X',
        '⌘C',
        '⌘V',
        '⌘A',
      ]);
      for (const item of opened[0].items) {
        expect(
          Object.keys(item).every((key: string): boolean =>
            ['id', 'label', 'shortcut', 'disabled', 'separator'].includes(key),
          ),
        ).toBe(true);
      }
      expect(register).not.toHaveBeenCalled();
      expect(registerGlobal).not.toHaveBeenCalled();
      expect(contribute).not.toHaveBeenCalled();
    });
  });

  describe('right-click', () => {
    it('outsideTheSelection_movesTheCaretToTheClick_andOpensAtThePointer', () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor({
        selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
      });
      const opened: { event: MouseEvent; subject: EditorContextMenuSubject }[] = [];
      const open: EditorContextMenuOpener = {
        open: (event: MouseEvent, subject: EditorContextMenuSubject): void =>
          void opened.push({ event, subject }),
      };
      menu.attach(fake.editor, open);

      const event: MouseEvent = fake.rightClick(TARGET.text, { lineNumber: 5, column: 3 });

      expect(fake.calls).toEqual(['focus', 'position 5:3']);
      expect(opened.length).toBe(1);
      expect(opened[0].event).toBe(event);
      expect(opened[0].subject.editor).toBe(fake.editor);
      // Built after the caret moved: nothing is selected any more, so Format Selection would be inert.
      expect(idsOf(opened[0].subject.items)).toContain('copy');
    });

    it('insideTheSelection_keepsTheSelection', () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor({
        selection: { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 9 },
      });
      const opened: EditorContextMenuSubject[] = [];
      menu.attach(fake.editor, { open: (_e, subject) => void opened.push(subject) });

      fake.rightClick(TARGET.empty, { lineNumber: 3, column: 5 });

      expect(fake.calls).toEqual(['focus']);
      expect(opened.length).toBe(1);
    });

    it('overTheGutter_opensNothing_asMonacosOwnMenuDidNot', () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor();
      const open: Mock<EditorContextMenuOpener['open']> = vi.fn<EditorContextMenuOpener['open']>();
      menu.attach(fake.editor, { open });

      fake.rightClick(TARGET.lineNumbers, { lineNumber: 3, column: 1 });

      expect(open).not.toHaveBeenCalled();
      expect(fake.calls).toEqual([]);
    });

    it('detach_stopsListening', () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor();

      const detach: () => void = menu.attach(fake.editor, { open: vi.fn() });
      expect(fake.listening()).toBe(true);
      detach();

      expect(fake.listening()).toBe(false);
    });
  });

  describe('commands', () => {
    it('findAndGoTo_goThroughStudiosRouters', () => {
      const menu: EditorContextMenu = build();
      const { editor } = fakeEditor();
      const find: MockInstance<FindRouter['openFromEditor']> = vi
        .spyOn(TestBed.inject(FindRouter), 'openFromEditor')
        .mockImplementation((): void => undefined);
      const goTo: MockInstance<GoToRouter['open']> = vi
        .spyOn(TestBed.inject(GoToRouter), 'open')
        .mockImplementation((): void => undefined);

      menu.run('find', editor);
      menu.run('symbol', editor);
      menu.run('line', editor);

      expect(find).toHaveBeenCalledWith(editor, 'find');
      expect(goTo.mock.calls).toEqual([
        [editor, 'symbol'],
        [editor, 'line'],
      ]);
    });

    it('clipboardAndEditing_focusTheEditor_andRunMonacosActions', () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor();

      menu.run('cut', fake.editor);
      menu.run('copy', fake.editor);
      menu.run('selectAll', fake.editor);
      menu.run('formatDocument', fake.editor);
      menu.run('formatSelection', fake.editor);
      menu.run('comment', fake.editor);

      expect(fake.calls).toEqual([
        'focus',
        'trigger editor.action.clipboardCutAction',
        'focus',
        'trigger editor.action.clipboardCopyAction',
        'focus',
        'trigger editor.action.selectAll',
        'focus',
        'run editor.action.formatDocument',
        'focus',
        'run editor.action.formatSelection',
        'focus',
        'run editor.action.commentLine',
      ]);
    });

    it('paste_readsTheClipboard_andReplacesTheSelection', async () => {
      const menu: EditorContextMenu = build();
      const fake: FakeEditor = fakeEditor({
        selection: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: (): Promise<string> => Promise.resolve('pasted') },
      });

      menu.run('paste', fake.editor);
      await Promise.resolve();
      await Promise.resolve();

      expect(fake.calls).toEqual(['focus']);
      expect(fake.edits.length).toBe(1);
      expect(fake.edits[0].text).toBe('pasted');
      expect(fake.edits[0].range).toMatchObject({ startColumn: 2, endColumn: 5 });
    });
  });

  describe('go to definition', () => {
    it('sameFile_fromTheLanguageServer_goesStraightThere_theFirstOfSeveral', async () => {
      const menu: EditorContextMenu = build();
      TestBed.inject(Editors).register(MODEL_URI, {
        documentId: 'doc-1',
        path: '/root/app.ts',
        name: 'app.ts',
      });
      lsp.definitions.mockResolvedValue([
        {
          path: '/root/app.ts',
          range: { startLineNumber: 8, startColumn: 3, endLineNumber: 8, endColumn: 9 },
        },
        {
          path: '/root/other.ts',
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
        },
      ]);
      const fake: FakeEditor = fakeEditor();

      await menu.goToDefinition(fake.editor);

      expect(fake.calls).toEqual(['position 8:3', 'centre 8:3', 'focus']);
      expect(opener.openPath).not.toHaveBeenCalled();
    });

    it('crossFile_fromTheLanguageServer_opensTheFile_thenRevealsInItsEditor', async () => {
      const menu: EditorContextMenu = build();
      const editors: Editors = TestBed.inject(Editors);
      editors.register(MODEL_URI, { documentId: 'doc-1', path: '/root/app.ts', name: 'app.ts' });
      opener.openPath.mockImplementation((): Promise<boolean> => {
        editors.register('inmemory://model/2', {
          documentId: 'doc-2',
          path: '/root/lib/greeter.ts',
          name: 'greeter.ts',
        });
        return Promise.resolve(true);
      });
      lsp.definitions.mockResolvedValue([
        {
          path: '/root/lib/greeter.ts',
          range: { startLineNumber: 5, startColumn: 14, endLineNumber: 5, endColumn: 21 },
        },
      ]);
      const fake: FakeEditor = fakeEditor();
      const reveal: MockInstance<Editors['requestReveal']> = vi.spyOn(editors, 'requestReveal');

      await menu.goToDefinition(fake.editor);

      expect(opener.openPath).toHaveBeenCalledWith('/root/lib/greeter.ts');
      expect(reveal).toHaveBeenCalledWith('doc-2', 5, 14);
      expect(fake.calls).toEqual([]);
    });

    it('crossFile_thatNothingCanOpen_staysPut', async () => {
      const menu: EditorContextMenu = build();
      opener.openPath.mockResolvedValue(false);
      lsp.definitions.mockResolvedValue([
        {
          path: '/elsewhere/x.ts',
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
        },
      ]);
      const fake: FakeEditor = fakeEditor();
      const reveal: MockInstance<Editors['requestReveal']> = vi.spyOn(
        TestBed.inject(Editors),
        'requestReveal',
      );

      await menu.goToDefinition(fake.editor);

      expect(reveal).not.toHaveBeenCalled();
      expect(fake.calls).toEqual([]);
    });

    it('noServer_asksMonacosProviders_andGoesWithinTheModel', async () => {
      const menu: EditorContextMenu = build();
      const uri: MonacoApi.Uri = { toString: (): string => MODEL_URI } as MonacoApi.Uri;
      monaco.languages.registerDefinitionProvider('typescript', {
        provideDefinition: (): MonacoApi.languages.LocationLink[] => [
          {
            uri,
            range: { startLineNumber: 3, startColumn: 1, endLineNumber: 6, endColumn: 2 },
            targetSelectionRange: {
              startLineNumber: 3,
              startColumn: 7,
              endLineNumber: 3,
              endColumn: 14,
            },
          },
        ],
      });
      const fake: FakeEditor = fakeEditor();

      await menu.goToDefinition(fake.editor);

      expect(lsp.definitions).toHaveBeenCalled();
      expect(fake.calls).toEqual(['position 3:7', 'centre 3:7', 'focus']);
    });

    it('serverKnowsNone_goesNowhere_withoutFallingBackToMonaco', async () => {
      const menu: EditorContextMenu = build();
      lsp.definitions.mockResolvedValue([]);
      const provide: Mock<MonacoApi.languages.DefinitionProvider['provideDefinition']> = vi.fn<
        MonacoApi.languages.DefinitionProvider['provideDefinition']
      >((): null => null);
      monaco.languages.registerDefinitionProvider('typescript', { provideDefinition: provide });
      const fake: FakeEditor = fakeEditor();

      await menu.goToDefinition(fake.editor);

      expect(provide).not.toHaveBeenCalled();
      expect(fake.calls).toEqual([]);
    });
  });
});
