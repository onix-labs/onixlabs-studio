import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type * as MonacoApi from 'monaco-editor';
import { EditorContextMenuHost } from '@shared/angular/components/editor-context-menu/editor-context-menu-host';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import type { Mock, MockInstance } from 'vitest';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Settings } from '@shared/angular/services/settings/settings';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import {
  FIND_HOST,
  FindAttachment,
  FindHost,
} from '@shared/angular/services/find-router/find-host';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import {
  REFERENCES_HOST,
  ReferencesHost,
} from '@shared/angular/services/references/reference-list';
import { ReferencesRouter } from '@shared/angular/services/references/references-router';
import { QuickFixes } from '@shared/angular/services/quick-fix/quick-fixes';
import { HoverCards } from '@shared/angular/services/hover/hover-cards';
import { Autocomplete } from '@shared/angular/services/autocomplete/autocomplete';
import { ColourPickers } from '@shared/angular/services/colour-picker/colour-pickers';
import { TextEditor } from './text-editor';
import type { EditorConfigProperties } from '@shared/api/editor-config-channels';

describe('TextEditor', () => {
  let fixture: ComponentFixture<TextEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(TextEditor);
    fixture.componentRef.setInput('content', 'hello');
    fixture.componentRef.setInput('language', 'plaintext');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_mountsTheMonacoHostElement', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.text-editor')).not.toBeNull();
  });

  it('api_beforeTheEditorIsCreated_reportsNoInstance', () => {
    // Monaco does not load under the test runner, so the engine is never created; the imperative API
    // stays null-safe.
    expect(fixture.componentInstance.getEditor()).toBeNull();
    expect(fixture.componentInstance.getModelUri()).toBeNull();
    expect(fixture.componentInstance.getValue()).toBe('');
  });
});

describe('TextEditor over a stand-in Monaco editor (#1007)', () => {
  afterEach(() => {
    localStorage.removeItem('settings');
  });

  /**
   * The tab Find panel the pane's enclosing tab provides.
   */
  const host: FindHost = { openFind: (): void => undefined };

  /**
   * Builds a stand-in Monaco editor: any member not named answers as a subscription would.
   * @param extra Members to add or override, such as recorders.
   * @returns Returns the editor.
   */
  function standInEditor(
    extra: Record<string, unknown> = {},
  ): MonacoApi.editor.IStandaloneCodeEditor {
    const model: unknown = {
      uri: { toString: (): string => 'inmemory://model/1' },
      onDidChangeOptions: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      getEOL: (): string => '\n',
      getLineCount: (): number => 1,
      getValue: (): string => '',
      getAllDecorations: (): unknown[] => [],
      getLanguageId: (): string => 'plaintext',
      getOptions: (): unknown => ({
        bracketPairColorizationOptions: { enabled: true },
        tabSize: 2,
        indentSize: 2,
        insertSpaces: true,
      }),
      detectIndentation: (): void => undefined,
      updateOptions: (): void => undefined,
    };
    const named: Record<string, unknown> = {
      getContainerDomNode: (): HTMLElement => document.body,
      getModel: (): unknown => model,
      getPosition: (): null => null,
      getValue: (): string => '',
      getVisibleRanges: (): unknown[] => [],
      createDecorationsCollection: (): unknown => ({
        set: (): void => undefined,
        clear: (): void => undefined,
      }),
      ...extra,
    };
    return new Proxy(named, {
      get: (target: Record<string, unknown>, key: string): unknown =>
        key in target
          ? target[key]
          : (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
    }) as unknown as MonacoApi.editor.IStandaloneCodeEditor;
  }

  /**
   * Builds a text editor over a model that keeps its indentation like Monaco's.
   * @param properties What the file's `.editorconfig` says.
   * @param detected What the model reads from its content.
   * @returns Returns the fixture, the model's options, and what re-seeds them.
   */
  async function indented(
    properties: EditorConfigProperties | null,
    detected: { tabSize: number; insertSpaces: boolean } = { tabSize: 4, insertSpaces: false },
    held: string = '',
  ): Promise<{
    fixture: ComponentFixture<TextEditor>;
    options: Record<string, unknown>;
    reseed: () => void;
    updateEditor: Mock<(options: unknown) => void>;
    setEOL: Mock<(eol: number) => void>;
    replaced: Mock<() => void>;
  }> {
    const options: Record<string, unknown> = {
      bracketPairColorizationOptions: { enabled: true },
      tabSize: 2,
      indentSize: 2,
      insertSpaces: true,
    };
    let onOptions: () => void = (): void => undefined;
    const setEOL: Mock<(eol: number) => void> = vi.fn<(eol: number) => void>();
    const replaced: Mock<() => void> = vi.fn<() => void>();
    const model: unknown = {
      uri: { toString: (): string => 'inmemory://model/2' },
      getFullModelRange: (): unknown => ({}),
      pushEditOperations: replaced,
      onDidChangeOptions: (listener: () => void): MonacoApi.IDisposable => {
        onOptions = listener;
        return { dispose: (): void => undefined };
      },
      getEOL: (): string => '\n',
      getLineCount: (): number => 1,
      getValue: (): string => '',
      getAllDecorations: (): unknown[] => [],
      getLanguageId: (): string => 'plaintext',
      getOptions: (): unknown => options,
      setEOL,
      detectIndentation: (): void => {
        Object.assign(options, detected, { indentSize: detected.tabSize });
        onOptions();
      },
      updateOptions: (changes: Record<string, unknown>): void => {
        Object.assign(options, changes);
        onOptions();
      },
    };
    const updateEditor: Mock<(options: unknown) => void> = vi.fn<(options: unknown) => void>();
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor({
      getModel: (): unknown => model,
      getValue: (): string => held,
      updateOptions: updateEditor,
    });
    const fakeMonaco: unknown = {
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
        EndOfLineSequence: { LF: 0, CRLF: 1 },
      },
    };
    await TestBed.configureTestingModule({
      imports: [TextEditor],
      providers: [{ provide: FIND_HOST, useValue: host }],
    }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue(fakeMonaco as typeof MonacoApi);
    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    fixture.componentRef.setInput('editorConfig', properties);
    fixture.componentRef.setInput('content', held);
    await fixture.whenStable();
    return {
      fixture,
      options,
      setEOL,
      replaced,
      updateEditor,
      reseed: (): void => {
        Object.assign(options, { tabSize: 2, indentSize: 2, insertSpaces: true });
        onOptions();
      },
    };
  }

  it('rebuildsTheCursorsOptions_whenAutoIndentChanges', async () => {
    const { fixture, updateEditor } = await indented(null);
    updateEditor.mockClear();

    TestBed.inject(Settings).set('textEditor.global.autoIndent', 'none');
    await fixture.whenStable();
    localStorage.removeItem('settings');

    expect(updateEditor).toHaveBeenCalledWith({ autoClosingDelete: 'never' });
    expect(updateEditor).toHaveBeenCalledWith({ autoClosingDelete: 'auto' });
  });

  it('readsIndentationFromTheContent_underDetectIndentation', async () => {
    const { options } = await indented(null);

    expect(options).toMatchObject({ tabSize: 4, indentSize: 4, insertSpaces: false });
  });

  it('keepsTheSettings_whenDetectIndentationIsOff', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ 'textEditor.global.detectIndentation': false }),
    );

    const { options } = await indented(null);

    expect(options).toMatchObject({ tabSize: 2, insertSpaces: true });
  });

  it('letsEditorConfigWinOverTheContent', async () => {
    const { options } = await indented({ indentStyle: 'space', indentSize: 8 });

    expect(options).toMatchObject({ tabSize: 8, indentSize: 8, insertSpaces: true });
  });

  it('putsTheIndentationBackWhenMonacoReseedsTheModel', async () => {
    const { options, reseed } = await indented({ indentStyle: 'tab', tabWidth: 8 });

    reseed();

    expect(options).toMatchObject({ tabSize: 8, insertSpaces: false });
  });

  it('reportsTheIndentationInForce', async () => {
    const seen: string[] = [];
    const { fixture } = await indented({ indentStyle: 'space', indentSize: 8 });
    fixture.componentInstance.indentationChange.subscribe((label: string): void => {
      seen.push(label);
    });

    fixture.componentRef.setInput('editorConfig', { indentStyle: 'tab', indentSize: 4 });
    await fixture.whenStable();

    expect(seen).toContain('Tabs: 4');
  });

  it('letsMaxLineLengthWinOverTheRulers', async () => {
    localStorage.setItem('settings', JSON.stringify({ 'textEditor.global.rulers': '80, 120' }));

    const { updateEditor } = await indented({ maxLineLength: 100 });

    expect(updateEditor).toHaveBeenCalledWith(expect.objectContaining({ rulers: [100] }));
  });

  it('drawsNoRuler_whenMaxLineLengthIsOff', async () => {
    localStorage.setItem('settings', JSON.stringify({ 'textEditor.global.rulers': '80' }));

    const { updateEditor } = await indented({ maxLineLength: 'off' });

    expect(updateEditor).toHaveBeenCalledWith(expect.objectContaining({ rulers: [] }));
  });

  it('convertsTheModelToTheFixedLineEnding', async () => {
    const { setEOL } = await indented({ endOfLine: 'crlf' });

    expect(setEOL).toHaveBeenCalledWith(1);
  });

  it('doesNotTakeAConvertedModelForDifferentText', async () => {
    const { fixture, replaced } = await indented(
      { endOfLine: 'crlf' },
      { tabSize: 4, insertSpaces: false },
      'a\r\nb',
    );

    fixture.componentRef.setInput('content', 'a\nb');
    await fixture.whenStable();

    expect(replaced).not.toHaveBeenCalled();
  });

  it('replacesTextWhereItStands_whenItReallyDiffers', async () => {
    const { fixture, replaced } = await indented(null, { tabSize: 4, insertSpaces: false }, 'a');

    fixture.componentRef.setInput('content', 'b');
    await fixture.whenStable();

    expect(replaced).toHaveBeenCalledTimes(1);
  });

  it('leavesTheLineEndingAloneForABareCr', async () => {
    const { setEOL } = await indented({ endOfLine: 'cr' });

    expect(setEOL).not.toHaveBeenCalled();
  });

  it('attachesItsEditorToTheFindRouter_withTheEnclosingTabsFindPanel_andDetachesOnDestroy', async () => {
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    const fakeMonaco: unknown = {
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    };
    await TestBed.configureTestingModule({
      imports: [TextEditor],
      providers: [{ provide: FIND_HOST, useValue: host }],
    }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue(fakeMonaco as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<FindRouter['attach']> = vi
      .spyOn(TestBed.inject(FindRouter), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    const [attached, attachment]: [MonacoApi.editor.ICodeEditor, FindAttachment] =
      attach.mock.calls[0];
    expect(attached).toBe(editor);
    expect(attachment.host).toBe(host);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorToTheReferencesRouter_withTheEnclosingTabsPanel_andDetachesOnDestroy', async () => {
    // #1014: outside a workspace, Find All References lists in the tab's own References panel.
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    const referencesHost: ReferencesHost = { openReferences: (): void => undefined };
    await TestBed.configureTestingModule({
      imports: [TextEditor],
      providers: [{ provide: REFERENCES_HOST, useValue: referencesHost }],
    }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<ReferencesRouter['attach']> = vi
      .spyOn(TestBed.inject(ReferencesRouter), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    // Compared by identity: the stand-in editor answers every member, so deep equality never ends.
    expect(attach.mock.calls[0][0]).toBe(editor);
    expect(attach.mock.calls[0][1]).toBe(referencesHost);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorsFixIcon_withItsMonaco_andTakesItAwayOnDestroy (#1016)', async () => {
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    const instance: typeof MonacoApi = {
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi;
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue(instance);
    let detached: number = 0;
    const attach: MockInstance<QuickFixes['attach']> = vi
      .spyOn(TestBed.inject(QuickFixes), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    expect(attach.mock.calls[0][1]).toBe(instance);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorsHoverCard_withItsOwnInjector_andTakesItAwayOnDestroy (#1020)', async () => {
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<HoverCards['attach']> = vi
      .spyOn(TestBed.inject(HoverCards), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    // The pane's own injector, which draws the card in the pane's window.
    expect(attach.mock.calls[0][1].get(TextEditor)).toBe(fixture.componentInstance);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorsCompletionList_withItsOwnInjector_andTakesItAwayOnDestroy (#1021)', async () => {
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<Autocomplete['attach']> = vi
      .spyOn(TestBed.inject(Autocomplete), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    // The pane's own injector, which draws the list and the card in the pane's window.
    expect(attach.mock.calls[0][1].get(TextEditor)).toBe(fixture.componentInstance);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorsColourPickers_withItsOwnInjector_andDetachesOnDestroy (#1025)', async () => {
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<ColourPickers['attach']> = vi
      .spyOn(TestBed.inject(ColourPickers), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    // The pane's own injector, which draws the picker in the pane's window.
    expect(attach.mock.calls[0][1].get(TextEditor)).toBe(fixture.componentInstance);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorToTheGoToRouter_withItsOwnInjector_andDetachesOnDestroy', async () => {
    // #1009: the injector places the quick-open box in the pane's own window.
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<GoToRouter['attach']> = vi
      .spyOn(TestBed.inject(GoToRouter), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    expect(attach.mock.calls[0][1].injector).toBeTruthy();
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('attachesItsEditorToTheRightClickMenu_withTheHostInItsOwnView_andDetachesOnDestroy', async () => {
    // #1012: the host sits in the pane's view, so the menu opens in the pane's window.
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor();
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    let detached: number = 0;
    const attach: MockInstance<EditorContextMenu['attach']> = vi
      .spyOn(TestBed.inject(EditorContextMenu), 'attach')
      .mockReturnValue((): void => void (detached += 1));

    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe(editor);
    const host: DebugElement = fixture.debugElement.query(By.directive(EditorContextMenuHost));
    expect(attach.mock.calls[0][1]).toBe(host.componentInstance);
    fixture.destroy();
    expect(detached).toBe(1);
  });

  it('paste_readsTheClipboardThroughTheEditorsWindow_andReplacesTheSelection', async () => {
    const edits: { text: string }[] = [];
    const container: HTMLElement = document.createElement('div');
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor({
      focus: (): void => undefined,
      getContainerDomNode: (): HTMLElement => container,
      getSelection: (): unknown => ({ startLineNumber: 1, startColumn: 1 }),
      executeEdits: (_source: string, operations: { text: string }[]): boolean => {
        edits.push(...operations);
        return true;
      },
    });
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue({
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    } as unknown as typeof MonacoApi);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: (): Promise<string> => Promise.resolve('from the clipboard') },
    });
    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();

    fixture.componentInstance.paste();
    await Promise.resolve();
    await Promise.resolve();

    expect(edits.map((edit: { text: string }): string => edit.text)).toEqual([
      'from the clipboard',
    ]);
  });

  it('reveal_withAnEndColumn_selectsTheSpan_centredAndFocused', async () => {
    // #1007: a search result is revealed as its match selected, not a bare caret beside it.
    const calls: string[] = [];
    let selection: MonacoApi.IRange | null = null;
    const editor: MonacoApi.editor.IStandaloneCodeEditor = standInEditor({
      layout: (): void => void calls.push('layout'),
      revealLineInCenter: (line: number): void => void calls.push(`centre ${line}`),
      setSelection: (range: MonacoApi.IRange): void => {
        selection = range;
        calls.push('select');
      },
      setPosition: (): void => void calls.push('position'),
      focus: (): void => void calls.push('focus'),
    });
    const fakeMonaco: unknown = {
      editor: {
        create: (): MonacoApi.editor.IStandaloneCodeEditor => editor,
        setTheme: (): void => undefined,
      },
    };
    await TestBed.configureTestingModule({ imports: [TextEditor] }).compileComponents();
    const monaco: Monaco = TestBed.inject(Monaco);
    vi.spyOn(monaco, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(monaco, 'getMonaco').mockReturnValue(fakeMonaco as typeof MonacoApi);
    const fixture: ComponentFixture<TextEditor> = TestBed.createComponent(TextEditor);
    await fixture.whenStable();
    calls.length = 0;

    fixture.componentInstance.reveal(4, 3, 7);

    expect(calls).toEqual(['layout', 'centre 4', 'select', 'focus']);
    expect(selection).toEqual({
      startLineNumber: 4,
      startColumn: 3,
      endLineNumber: 4,
      endColumn: 7,
    });
  });
});
