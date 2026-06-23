import type * as MonacoApi from 'monaco-editor';
import {
  ChangeMarginController,
  ChangeMarginOptions,
  DEFAULT_CHANGE_MARGIN_OPTIONS,
} from './change-margin-controller';
import { splitLines } from './line-diff';

/**
 * Holds the test options: an immediate (zero-delay) debounce so the content-change path can be flushed
 * with the fake timer.
 */
const TEST_OPTIONS: ChangeMarginOptions = { ...DEFAULT_CHANGE_MARGIN_OPTIONS, debounceMs: 0 };

/**
 * Captures a decoration's gutter class and the line it sits on, for concise assertions.
 */
interface CapturedDecoration {
  readonly className: string | null | undefined;
  readonly line: number;
}

/**
 * Drives a stubbed Monaco editor and exposes the hooks the tests need to mutate the buffer, flush the
 * debounced refresh, and inspect what the controller wrote.
 */
interface EditorHarness {
  readonly monaco: typeof MonacoApi;
  readonly editor: MonacoApi.editor.IStandaloneCodeEditor;
  setValue(value: string): void;
  decorations(): CapturedDecoration[];
  clears(): number;
  contentDisposed(): boolean;
  modelDisposed(): boolean;
}

/**
 * Builds a stubbed editor and Monaco namespace seeded with the given content.
 * @param initial The initial buffer content.
 * @returns Returns the harness.
 */
function createHarness(initial: string): EditorHarness {
  let value: string = initial;
  let written: MonacoApi.editor.IModelDeltaDecoration[] = [];
  let clearCount: number = 0;
  let contentDisposed: boolean = false;
  let modelDisposed: boolean = false;

  const model: MonacoApi.editor.ITextModel = {
    getValue: (): string => value,
    getLineCount: (): number => splitLines(value).length,
  } as unknown as MonacoApi.editor.ITextModel;

  const collection: MonacoApi.editor.IEditorDecorationsCollection = {
    set: (decorations: MonacoApi.editor.IModelDeltaDecoration[]): void => {
      written = decorations;
    },
    clear: (): void => {
      written = [];
      clearCount += 1;
    },
  } as unknown as MonacoApi.editor.IEditorDecorationsCollection;

  const editor: MonacoApi.editor.IStandaloneCodeEditor = {
    createDecorationsCollection: (): MonacoApi.editor.IEditorDecorationsCollection => collection,
    onDidChangeModelContent: (): MonacoApi.IDisposable => ({
      dispose: (): void => {
        contentDisposed = true;
      },
    }),
    onDidChangeModel: (): MonacoApi.IDisposable => ({
      dispose: (): void => {
        modelDisposed = true;
      },
    }),
    getModel: (): MonacoApi.editor.ITextModel => model,
  } as unknown as MonacoApi.editor.IStandaloneCodeEditor;

  class Range {
    public constructor(
      public readonly startLineNumber: number,
      public readonly startColumn: number,
      public readonly endLineNumber: number,
      public readonly endColumn: number,
    ) {}
  }

  const monaco: typeof MonacoApi = {
    Range,
    editor: { OverviewRulerLane: { Left: 1 } },
  } as unknown as typeof MonacoApi;

  return {
    monaco,
    editor,
    setValue: (next: string): void => {
      value = next;
    },
    decorations: (): CapturedDecoration[] =>
      written.map(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): CapturedDecoration => ({
          className: decoration.options.linesDecorationsClassName,
          line: (decoration.range as unknown as { startLineNumber: number }).startLineNumber,
        }),
      ),
    clears: (): number => clearCount,
    contentDisposed: (): boolean => contentDisposed,
    modelDisposed: (): boolean => modelDisposed,
  };
}

/**
 * Edits the buffer, then flushes the controller's debounced refresh.
 * @param harness The editor harness.
 * @param controller The controller under test.
 * @param value The new buffer content.
 */
function edit(harness: EditorHarness, controller: ChangeMarginController, value: string): void {
  harness.setValue(value);
  // The controller debounces refreshes from content changes; flush the timer to run the diff.
  (controller as unknown as { scheduleRefresh(): void }).scheduleRefresh();
  vi.runAllTimers();
}

/**
 * Signals a content change WITHOUT flushing timers, so a test can observe the leading-edge redraw.
 * @param harness The editor harness.
 * @param controller The controller under test.
 * @param value The new buffer content.
 */
function editWithoutFlushing(
  harness: EditorHarness,
  controller: ChangeMarginController,
  value: string,
): void {
  harness.setValue(value);
  (controller as unknown as { scheduleRefresh(): void }).scheduleRefresh();
}

/**
 * Lists the lines carrying the given gutter class.
 * @param harness The editor harness.
 * @param className The gutter class to filter by.
 * @returns Returns the sorted line numbers.
 */
function linesWith(harness: EditorHarness, className: string): number[] {
  return harness
    .decorations()
    .filter((decoration: CapturedDecoration): boolean => decoration.className === className)
    .map((decoration: CapturedDecoration): number => decoration.line)
    .sort((left: number, right: number): number => left - right);
}

describe('ChangeMarginController', () => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('open_whenSavedDocumentUnchanged_marksEveryLineSaved', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );

    expect(linesWith(harness, 'change-margin--saved')).toEqual([1, 2, 3]);
    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([]);

    controller.dispose();
  });

  it('edit_whenChanged_redrawsImmediatelyWithoutWaitingForTheDebounce', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );

    // Insert a line; the leading-edge redraw must mark line 2 before any timer fires, so the user
    // never sees the new line unmarked or the marks shifted during the debounce window.
    editWithoutFlushing(harness, controller, 'a\n\nb\nc');

    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([2]);
    expect(linesWith(harness, 'change-margin--saved')).toEqual([1, 3, 4]);
  });

  it('edit_whenLineModified_marksItUnsavedAndKeepsOthersSaved', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );

    edit(harness, controller, 'a\nB\nc');

    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([2]);
    expect(linesWith(harness, 'change-margin--saved')).toEqual([1, 3]);
  });

  it('setBaseline_whenSaved_flipsUnsavedLineBackToSaved', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );
    edit(harness, controller, 'a\nB\nc');

    controller.setBaseline('a\nB\nc', true);

    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([]);
    expect(linesWith(harness, 'change-margin--saved')).toEqual([1, 2, 3]);
  });

  it('edit_whenNewDocumentWithNoSavedVersion_marksEveryLineIncludingTheFirstUnsaved', () => {
    const harness: EditorHarness = createHarness('');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      '',
      false,
      TEST_OPTIONS,
    );

    // Pressing enter on a new, never-saved document: every line, line 1 included, is unsaved.
    edit(harness, controller, '\n');

    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([1, 2]);
    expect(linesWith(harness, 'change-margin--saved')).toEqual([]);
  });

  it('edit_whenLineDeleted_marksDeletionCaretOnSurvivingLineAbove', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );

    edit(harness, controller, 'a\nc');

    expect(linesWith(harness, 'change-margin--deleted')).toEqual([1]);
    expect(linesWith(harness, 'change-margin--saved')).toEqual([1, 2]);
    expect(linesWith(harness, 'change-margin--unsaved')).toEqual([]);
  });

  it('dispose_whenCalled_clearsDecorationsAndDisposesListeners', () => {
    const harness: EditorHarness = createHarness('a\nb\nc');
    const controller: ChangeMarginController = new ChangeMarginController(
      harness.monaco,
      harness.editor,
      'a\nb\nc',
      true,
      TEST_OPTIONS,
    );
    const clearsBefore: number = harness.clears();

    controller.dispose();

    expect(harness.clears()).toBe(clearsBefore + 1);
    expect(harness.contentDisposed()).toBe(true);
    expect(harness.modelDisposed()).toBe(true);
  });
});
