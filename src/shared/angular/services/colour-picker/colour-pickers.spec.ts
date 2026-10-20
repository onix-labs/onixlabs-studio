import { ApplicationRef, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { COLOUR_SWATCH_CLASS } from '@shared/angular/services/monaco/monaco-widget-guard';
import { ColourPickers, swatchClicked, swatchRange } from './colour-pickers';

/**
 * One edit the stand-in editor was asked to make.
 */
interface MadeEdit {
  readonly source: string;
  readonly edits: readonly { range: MonacoApi.IRange; text: string }[];
}

/**
 * A stand-in editor over one line of text, and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
  readonly edits: MadeEdit[];
  text: string;
  version: number;
  readOnly: boolean;
  decorations: MonacoApi.editor.IModelDecoration[];
  click(event: MonacoApi.editor.IEditorMouseEvent): void;
  mouseListeners: number;
}

/**
 * Builds a swatch decoration over a span of line one, as Monaco's colour decorator does.
 * @param start The colour's first column.
 * @param end The column after its last.
 * @returns Returns the decoration.
 */
function swatch(start: number, end: number): MonacoApi.editor.IModelDecoration {
  return {
    id: `swatch ${start}`,
    ownerId: 1,
    range: { startLineNumber: 1, startColumn: start, endLineNumber: 1, endColumn: end },
    options: {
      description: 'colorDetector',
      before: { content: ' ', inlineClassName: `ced-1 ${COLOUR_SWATCH_CLASS}` },
    },
  } as unknown as MonacoApi.editor.IModelDecoration;
}

/**
 * Builds a stand-in editor holding a line of text, its swatches given by the test.
 * @param text The line.
 * @returns Returns the editor and its recorder.
 */
function fakeEditor(text: string): FakeEditor {
  const container: HTMLElement = document.createElement('div');
  document.body.appendChild(container);
  let listener: ((event: MonacoApi.editor.IEditorMouseEvent) => void) | null = null;
  const fake: FakeEditor = {
    editor: null as unknown as MonacoApi.editor.ICodeEditor,
    calls: [],
    edits: [],
    text,
    version: 1,
    readOnly: false,
    decorations: [],
    mouseListeners: 0,
    click: (event: MonacoApi.editor.IEditorMouseEvent): void => listener?.(event),
  };
  const model: unknown = {
    getLanguageId: (): string => 'css',
    getVersionId: (): number => fake.version,
    getValueInRange: (range: MonacoApi.IRange): string =>
      fake.text.slice(range.startColumn - 1, range.endColumn - 1),
  };
  (fake as { editor: unknown }).editor = {
    getModel: (): unknown => model,
    getOption: (): boolean => fake.readOnly,
    getContainerDomNode: (): HTMLElement => container,
    getDomNode: (): HTMLElement => container,
    getScrolledVisiblePosition: (): { top: number; left: number; height: number } => ({
      top: 0,
      left: 0,
      height: 18,
    }),
    getLineDecorations: (line: number): MonacoApi.editor.IModelDecoration[] =>
      fake.decorations.filter(
        (decoration: MonacoApi.editor.IModelDecoration): boolean =>
          decoration.range.startLineNumber === line,
      ),
    onMouseDown: (
      handler: (event: MonacoApi.editor.IEditorMouseEvent) => void,
    ): MonacoApi.IDisposable => {
      listener = handler;
      fake.mouseListeners += 1;
      return {
        dispose: (): void => {
          listener = null;
          fake.mouseListeners -= 1;
        },
      };
    },
    pushUndoStop: (): boolean => {
      fake.calls.push('undo stop');
      return true;
    },
    executeEdits: (source: string, edits: { range: MonacoApi.IRange; text: string }[]): boolean => {
      fake.calls.push('edit');
      fake.edits.push({
        source,
        edits: edits.map((edit: { range: MonacoApi.IRange; text: string }) => ({
          range: { ...edit.range },
          text: edit.text,
        })),
      });
      return true;
    },
    focus: (): void => void fake.calls.push('focus'),
  };
  return fake;
}

/**
 * Builds a Monaco instance for the editor's window, prepared as the real one is so colour providers
 * can register.
 * @returns Returns the instance.
 */
function fakeMonaco(): typeof MonacoApi {
  const register: () => MonacoApi.IDisposable = (): MonacoApi.IDisposable => ({
    dispose: (): void => undefined,
  });
  const monaco: typeof MonacoApi = {
    editor: { EditorOption: { readOnly: 99 } },
    languages: {
      registerDefinitionProvider: register,
      registerReferenceProvider: register,
      registerRenameProvider: register,
      registerCodeActionProvider: register,
      registerHoverProvider: register,
      registerColorProvider: register,
      setLanguageConfiguration: register,
    },
    Range: { lift: (range: MonacoApi.IRange): MonacoApi.IRange => range },
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
 * Builds a mouse-down on the text.
 * @param column The column Monaco reports.
 * @param className The class of the element under the pointer.
 * @param leftButton Whether it is the primary button.
 * @returns Returns the event.
 */
function mouseDown(
  column: number,
  className: string = `ced-1 ${COLOUR_SWATCH_CLASS}`,
  leftButton: boolean = true,
): MonacoApi.editor.IEditorMouseEvent {
  const element: HTMLElement = document.createElement('span');
  element.className = className;
  return {
    event: { leftButton },
    target: { type: 6, element, position: { lineNumber: 1, column }, range: null, detail: {} },
  } as unknown as MonacoApi.editor.IEditorMouseEvent;
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
 * Finds the picker in the page.
 * @returns Returns its element, or null when none shows.
 */
function picker(): HTMLElement | null {
  return document.querySelector('app-colour-picker');
}

/**
 * Clicks the picker's button with a label.
 * @param label The button's label.
 */
function press(label: string): void {
  const button: HTMLButtonElement | undefined = [
    ...(picker()?.querySelectorAll('button') ?? []),
  ].find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
  if (button === undefined) {
    throw new Error(`No ${label} button`);
  }
  button.click();
}

/**
 * Types a colour into the picker's hex field, switching to the hex mode first.
 * @param text The colour.
 */
async function typeHex(text: string): Promise<void> {
  press('Hex');
  await settle();
  const field: HTMLInputElement =
    picker()!.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

describe('ColourPickers (#1025)', () => {
  let monaco: typeof MonacoApi;
  let pickers: ColourPickers;
  let fake: FakeEditor;
  let detach: () => void;

  beforeEach(() => {
    monaco = fakeMonaco();
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    pickers = TestBed.inject(ColourPickers);
    fake = fakeEditor('a { color: rgb(255, 0, 0); background: #00f; }');
    fake.decorations = [swatch(12, 26), swatch(40, 44)];
    detach = pickers.attach(fake.editor, TestBed.inject(Injector));
  });

  afterEach(() => {
    detach();
    delete (window as unknown as { monaco?: unknown }).monaco;
    document.body.innerHTML = '';
  });

  it('aClickOnASwatch_opensStudiosPicker_andApplyWritesTheColourAsWritten_asOneUndoStep', async () => {
    fake.click(mouseDown(12));
    await settle();
    expect(picker()).not.toBeNull();

    await typeHex('#00ff0080');
    press('Apply');
    await settle();

    expect(picker()).toBeNull();
    expect(fake.edits).toEqual([
      {
        source: 'studio.colourPicker',
        edits: [
          {
            range: { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 26 },
            text: 'rgba(0, 255, 0, 0.5)',
          },
        ],
      },
    ]);
    // The editor has the keyboard back, and the edit is fenced by undo stops: one ⌘Z undoes it.
    expect(fake.calls).toEqual(['focus', 'undo stop', 'edit', 'undo stop']);
  });

  it('theFormatSwitcher_convertsTheWrittenColour', async () => {
    fake.click(mouseDown(40));
    await settle();

    const writeAs: HTMLElement = picker()!.querySelector<HTMLElement>('.colour-picker__format')!;
    [...writeAs.querySelectorAll('button')]
      .find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'HSL')
      ?.click();
    await settle();
    press('Apply');
    await settle();

    expect(fake.edits[0].edits[0].text).toBe('hsl(240, 100%, 50%)');
  });

  it('escapeAndAClickOutside_closeThePicker_writingNothing', async () => {
    fake.click(mouseDown(12));
    await settle();
    await typeHex('#123456');
    picker()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(picker()).toBeNull();

    fake.click(mouseDown(40));
    await settle();
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    await settle();

    expect(picker()).toBeNull();
    expect(fake.edits).toEqual([]);
    expect(fake.calls).toEqual(['focus', 'focus']);
  });

  it('applyingTheColourUnchanged_writesNothing', async () => {
    fake.click(mouseDown(40));
    await settle();
    press('Apply');
    await settle();

    expect(fake.edits).toEqual([]);
  });

  it('aDocumentChangedUnderThePicker_isNotWrittenOver', async () => {
    fake.click(mouseDown(12));
    await settle();
    await typeHex('#123456');
    fake.version += 1;
    press('Apply');
    await settle();

    expect(fake.edits).toEqual([]);
  });

  it('opensNothing_inAReadOnlyEditor_offASwatch_orForAnotherButton', async () => {
    fake.readOnly = true;
    fake.click(mouseDown(12));
    await settle();
    expect(picker()).toBeNull();

    fake.readOnly = false;
    fake.click(mouseDown(12, 'mtk1'));
    fake.click(mouseDown(12, `ced-1 ${COLOUR_SWATCH_CLASS}`, false));
    await settle();
    expect(picker()).toBeNull();
    expect(await pickers.openAt(fake.editor, { lineNumber: 2, column: 1 }, null)).toBe(false);
  });

  it('textStudioCannotRead_isReadAndWrittenByTheProviderThatFoundIt', async () => {
    fake.text = 'a { color: Color(1, 0, 0); }';
    fake.decorations = [swatch(12, 26)];
    const asked: MonacoApi.languages.IColor[] = [];
    monaco.languages.registerColorProvider('css', {
      provideDocumentColors: (): MonacoApi.languages.IColorInformation[] => [
        {
          range: { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 26 },
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
        },
      ],
      provideColorPresentations: (
        _model: MonacoApi.editor.ITextModel,
        info: MonacoApi.languages.IColorInformation,
      ): MonacoApi.languages.IColorPresentation[] => {
        asked.push(info.color);
        return [
          {
            label: 'Color(0, 0, 1)',
            additionalTextEdits: [
              {
                range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                text: '/* picked */',
              },
            ],
          },
          { label: 'never chosen' },
        ];
      },
    });

    fake.click(mouseDown(12));
    await settle();
    expect(picker()?.querySelector('.colour-picker__format')).toBeNull();
    await typeHex('#0000ff');
    press('Apply');
    await settle();

    expect(asked).toEqual([{ red: 0, green: 0, blue: 1, alpha: 1 }]);
    expect(fake.edits[0].edits.map((edit: { text: string }): string => edit.text)).toEqual([
      'Color(0, 0, 1)',
      '/* picked */',
    ]);
  });

  it('remembersThePickMode_forTheNextPicker', async () => {
    fake.click(mouseDown(12));
    await settle();
    press('RGB');
    await settle();
    press('Cancel');
    await settle();

    fake.click(mouseDown(40));
    await settle();

    expect(picker()?.querySelector('input[type="number"][aria-label="Red"]')).not.toBeNull();
  });

  it('detaching_closesThePicker_andStopsListening', async () => {
    fake.click(mouseDown(12));
    await settle();

    detach();
    await settle();

    expect(picker()).toBeNull();
    expect(fake.mouseListeners).toBe(0);
    detach = (): void => undefined;
  });

  it('swatchRange_takesTheNearestSwatchOnTheLine', () => {
    expect(swatchRange(fake.editor, { lineNumber: 1, column: 41 })?.startColumn).toBe(40);
    expect(swatchRange(fake.editor, { lineNumber: 1, column: 13 })?.startColumn).toBe(12);
    expect(swatchRange(fake.editor, { lineNumber: 2, column: 1 })).toBeNull();
    expect(swatchClicked(mouseDown(12))?.column).toBe(12);
    expect(swatchClicked(mouseDown(12, 'mtk1'))).toBeNull();
  });
});
