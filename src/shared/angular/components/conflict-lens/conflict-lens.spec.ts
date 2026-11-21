import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MonacoApi from 'monaco-editor';
import { ConflictBlock } from '@shared/angular/services/repository/conflict-resolution';
import {
  adjacentConflict,
  conflictEdit,
  ConflictLens,
  ConflictLensHost,
  ConflictLensLabels,
} from './conflict-lens';

/**
 * Describes one edit the fake editor was asked to make.
 */
interface RecordedEdit {
  readonly range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  readonly text: string;
}

/**
 * Stands in for Monaco's editor: a model over a list of lines, the edits and undo stops it was asked
 * for, the zones it holds and the decorations it drew.
 */
class FakeEditor {
  /**
   * Holds the file's lines.
   */
  public lines: string[];

  /**
   * Holds what was done, in order: `edit` and `undo-stop`.
   */
  public readonly steps: string[] = [];

  /**
   * Holds the edits made.
   */
  public readonly edits: RecordedEdit[] = [];

  /**
   * Holds the zones in place, by id.
   */
  public readonly zones: Map<string, MonacoApi.editor.IViewZone> = new Map<
    string,
    MonacoApi.editor.IViewZone
  >();

  /**
   * Holds the decorations last drawn.
   */
  public decorations: readonly MonacoApi.editor.IModelDeltaDecoration[] = [];

  /**
   * Holds the caret's line.
   */
  public caretLine: number = 1;

  /**
   * Holds the next zone id.
   */
  private nextZone: number = 1;

  /**
   * Initializes the fake over some text.
   * @param text The file's content.
   */
  public constructor(text: string) {
    this.lines = text.split('\n');
  }

  /**
   * Gets the fake as Monaco's editor.
   * @returns Returns the editor.
   */
  public asEditor(): MonacoApi.editor.IStandaloneCodeEditor {
    const model: Partial<MonacoApi.editor.ITextModel> = {
      getValue: (): string => this.lines.join('\n'),
      getLinesContent: (): string[] => [...this.lines],
      getEOL: (): string => '\n',
    };
    const editor: Partial<MonacoApi.editor.IStandaloneCodeEditor> = {
      getModel: (): MonacoApi.editor.ITextModel => model as MonacoApi.editor.ITextModel,
      createDecorationsCollection: (): MonacoApi.editor.IEditorDecorationsCollection =>
        ({
          set: (decorations: readonly MonacoApi.editor.IModelDeltaDecoration[]): string[] => {
            this.decorations = decorations;
            return [];
          },
          clear: (): void => {
            this.decorations = [];
          },
        }) as unknown as MonacoApi.editor.IEditorDecorationsCollection,
      onDidChangeModelContent: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      changeViewZones: (
        callback: (accessor: MonacoApi.editor.IViewZoneChangeAccessor) => void,
      ): void =>
        callback({
          addZone: (zone: MonacoApi.editor.IViewZone): string => {
            const id: string = `zone-${this.nextZone++}`;
            this.zones.set(id, zone);
            return id;
          },
          removeZone: (id: string): void => void this.zones.delete(id),
          layoutZone: (): void => undefined,
        }),
      pushUndoStop: (): boolean => {
        this.steps.push('undo-stop');
        return true;
      },
      executeEdits: (
        _source: string | null | undefined,
        edits: MonacoApi.editor.IIdentifiedSingleEditOperation[],
      ): boolean => {
        this.steps.push('edit');
        for (const edit of edits) {
          const recorded: RecordedEdit = {
            range: {
              startLineNumber: edit.range.startLineNumber,
              startColumn: edit.range.startColumn,
              endLineNumber: edit.range.endLineNumber,
              endColumn: edit.range.endColumn,
            },
            text: edit.text ?? '',
          };
          this.edits.push(recorded);
          this.apply(recorded);
        }
        return true;
      },
      getPosition: (): MonacoApi.Position =>
        ({ lineNumber: this.caretLine, column: 1 }) as MonacoApi.Position,
      setPosition: (position: MonacoApi.IPosition): void => {
        this.caretLine = position.lineNumber;
      },
      revealLineInCenterIfOutsideViewport: (): void => undefined,
      focus: (): void => undefined,
    };
    return editor as MonacoApi.editor.IStandaloneCodeEditor;
  }

  /**
   * Gets each zone's row text, top to bottom.
   * @returns Returns the rows' text.
   */
  public rows(): string[] {
    return [...this.zones.values()]
      .sort(
        (a: MonacoApi.editor.IViewZone, b: MonacoApi.editor.IViewZone): number =>
          a.afterLineNumber - b.afterLineNumber,
      )
      .map((zone: MonacoApi.editor.IViewZone): string => zone.domNode.textContent ?? '');
  }

  /**
   * Presses a button in a zone.
   * @param afterLine The zone's line.
   * @param label The button's text.
   */
  public press(afterLine: number, label: string): void {
    const zone: MonacoApi.editor.IViewZone | undefined = [...this.zones.values()].find(
      (candidate: MonacoApi.editor.IViewZone): boolean => candidate.afterLineNumber === afterLine,
    );
    [...(zone?.domNode.querySelectorAll('button') ?? [])]
      .find((button: HTMLButtonElement): boolean => button.textContent === label)
      ?.click();
  }

  /**
   * Applies an edit to the lines, as the model would.
   * @param edit The edit.
   */
  private apply(edit: RecordedEdit): void {
    const text: string = this.lines.join('\n');
    const offset: (line: number, column: number) => number = (
      line: number,
      column: number,
    ): number =>
      this.lines
        .slice(0, line - 1)
        .reduce((sum: number, l: string): number => sum + l.length + 1, 0) +
      column -
      1;
    const start: number = offset(edit.range.startLineNumber, edit.range.startColumn);
    const end: number = offset(edit.range.endLineNumber, edit.range.endColumn);
    this.lines = (text.slice(0, start) + edit.text + text.slice(end)).split('\n');
  }
}

/**
 * Builds the lens's host over fixed answers.
 * @param labels The labels.
 * @param conflicted Whether the file is conflicted in its repository.
 * @returns Returns the host and its records.
 */
function hostOf(
  labels: ConflictLensLabels,
  conflicted: boolean = true,
): { host: ConflictLensHost; counts: number[]; resolved: number[] } {
  const counts: number[] = [];
  const resolved: number[] = [];
  return {
    host: {
      labels: (): ConflictLensLabels => labels,
      canMarkResolved: (): boolean => conflicted,
      markResolved: (): void => void resolved.push(1),
      countChanged: (count: number): void => void counts.push(count),
    },
    counts,
    resolved,
  };
}

/**
 * The labels in a merge of feature into main.
 */
const MERGE: ConflictLensLabels = {
  yours: 'Keep main (Yours)',
  theirs: 'Keep feature (Theirs)',
  swapped: false,
};

/**
 * The labels in a rebase of feature onto main: the user's commit is written below the divider.
 */
const REBASE: ConflictLensLabels = {
  yours: 'Keep feature (Yours)',
  theirs: 'Keep main (Theirs)',
  swapped: true,
};

/**
 * A file with two conflicts.
 */
const FILE: string = [
  'start',
  '<<<<<<< HEAD',
  'top one',
  '=======',
  'bottom one',
  '>>>>>>> feature',
  'middle',
  '<<<<<<< HEAD',
  'top two',
  '=======',
  'bottom two',
  '>>>>>>> feature',
  'end',
].join('\n');

describe('conflictEdit', () => {
  const lines: readonly string[] = FILE.split('\n');
  const first: ConflictBlock = { start: 2, base: null, divider: 4, end: 6 };

  it('replacesTheBlock_throughTheStartOfTheNextLine', () => {
    expect(conflictEdit(lines, '\n', first, 'top')).toEqual({
      range: { startLineNumber: 2, startColumn: 1, endLineNumber: 7, endColumn: 1 },
      text: 'top one\n',
    });
  });

  it('removesTheBlockAndItsLineEnding_whenNothingIsKept', () => {
    const empty: readonly string[] = ['a', '<<<<<<< HEAD', '=======', '>>>>>>> f', 'b'];

    expect(
      conflictEdit(empty, '\n', { start: 2, base: null, divider: 3, end: 4 }, 'both').text,
    ).toBe('');
  });

  it('leavesNoDanglingLine_whenTheBlockEndsTheFile', () => {
    const tail: readonly string[] = ['a', '<<<<<<< HEAD', '=======', '>>>>>>> f'];

    expect(conflictEdit(tail, '\n', { start: 2, base: null, divider: 3, end: 4 }, 'top')).toEqual({
      range: { startLineNumber: 1, startColumn: 2, endLineNumber: 4, endColumn: 10 },
      text: '',
    });
  });
});

describe('adjacentConflict', () => {
  const blocks: readonly ConflictBlock[] = [
    { start: 2, base: null, divider: 4, end: 6 },
    { start: 8, base: null, divider: 10, end: 12 },
  ];

  it.each([
    [1, 'next', 2],
    [2, 'next', 8],
    [9, 'next', 2],
    [13, 'previous', 8],
    [8, 'previous', 2],
    [1, 'previous', 8],
  ] as const)(
    'from line %i, %s lands on %i_wrappingRound',
    (line: number, direction: 'next' | 'previous', start: number) => {
      expect(adjacentConflict(blocks, line, direction)?.start).toBe(start);
    },
  );

  it('findsNothing_inAFileWithoutConflicts', () => {
    expect(adjacentConflict([], 1, 'next')).toBeNull();
  });
});

describe('ConflictLens', () => {
  let lens: ConflictLens | null;

  beforeEach(() => {
    lens = null;
  });

  afterEach(() => {
    lens?.dispose();
    vi.useRealTimers();
  });

  it('drawsARowAboveEachConflict_withTheSidesByName', () => {
    const editor: FakeEditor = new FakeEditor(FILE);
    const { host, counts } = hostOf(MERGE);

    lens = new ConflictLens(editor.asEditor(), host);

    expect(editor.rows()).toEqual([
      'Keep main (Yours)·Keep feature (Theirs)·Keep Both',
      'Keep main (Yours)·Keep feature (Theirs)·Keep Both',
    ]);
    expect([...editor.zones.values()].map((zone) => zone.afterLineNumber)).toEqual([1, 7]);
    expect([...editor.zones.values()].every((zone) => zone.suppressMouseDown === true)).toBe(true);
    expect(counts).toEqual([2]);
  });

  it('highlightsTheSectionsByWhoseTheyAre_andFlipsThemInARebase', () => {
    const merge: FakeEditor = new FakeEditor(FILE);
    const rebase: FakeEditor = new FakeEditor(FILE);
    const classOn: (editor: FakeEditor, line: number) => string | undefined = (
      editor: FakeEditor,
      line: number,
    ): string | undefined =>
      editor.decorations.find(
        (decoration) =>
          decoration.range.startLineNumber === line && decoration.options.className !== undefined,
      )?.options.className ?? undefined;

    lens = new ConflictLens(merge.asEditor(), hostOf(MERGE).host);
    const second: ConflictLens = new ConflictLens(rebase.asEditor(), hostOf(REBASE).host);

    expect(classOn(merge, 2)).toBe('conflict-lens__marker');
    expect(classOn(merge, 3)).toBe('conflict-lens__yours');
    expect(classOn(merge, 5)).toBe('conflict-lens__theirs');
    expect(classOn(rebase, 3)).toBe('conflict-lens__theirs');
    expect(classOn(rebase, 5)).toBe('conflict-lens__yours');
    second.dispose();
  });

  it.each([
    ['in a merge, Keep Yours keeps the top', MERGE, 'Keep main (Yours)', 'top one'],
    ['in a merge, Keep Theirs keeps the bottom', MERGE, 'Keep feature (Theirs)', 'bottom one'],
    ['in a rebase, Keep Yours keeps the bottom', REBASE, 'Keep feature (Yours)', 'bottom one'],
    ['in a rebase, Keep Theirs keeps the top', REBASE, 'Keep main (Theirs)', 'top one'],
  ])('%s', (_label: string, labels: ConflictLensLabels, button: string, kept: string) => {
    const editor: FakeEditor = new FakeEditor(FILE);
    lens = new ConflictLens(editor.asEditor(), hostOf(labels).host);

    editor.press(1, button);

    expect(editor.lines.slice(0, 3)).toEqual(['start', kept, 'middle']);
  });

  it('settlesAConflict_asOneUndoStep', () => {
    const editor: FakeEditor = new FakeEditor(FILE);
    lens = new ConflictLens(editor.asEditor(), hostOf(MERGE).host);

    editor.press(7, 'Keep Both');

    expect(editor.steps).toEqual(['undo-stop', 'edit', 'undo-stop']);
    expect(editor.lines).toEqual([
      'start',
      '<<<<<<< HEAD',
      'top one',
      '=======',
      'bottom one',
      '>>>>>>> feature',
      'middle',
      'top two',
      'bottom two',
      'end',
    ]);
    expect(editor.rows()).toHaveLength(1);
  });

  it('offersMarkResolved_onceAConflictedFileHasNoneLeft', () => {
    const editor: FakeEditor = new FakeEditor(FILE);
    const { host, resolved, counts } = hostOf(MERGE);
    lens = new ConflictLens(editor.asEditor(), host);

    editor.press(7, 'Keep main (Yours)');
    editor.press(1, 'Keep main (Yours)');

    expect(editor.rows()).toEqual(['No conflicts left in this file.·Mark Resolved']);
    editor.press(0, 'Mark Resolved');
    expect(resolved).toEqual([1]);
    expect(counts).toEqual([2, 1, 0]);
  });

  it('offersNothing_forAFileTheRepositoryDoesNotHoldConflicted', () => {
    const editor: FakeEditor = new FakeEditor('nothing to see');

    lens = new ConflictLens(editor.asEditor(), hostOf(MERGE, false).host);

    expect(editor.rows()).toEqual([]);
    expect(editor.decorations).toEqual([]);
  });

  it('goTo_movesTheCaretToTheNextAndPreviousConflict', () => {
    const editor: FakeEditor = new FakeEditor(FILE);
    lens = new ConflictLens(editor.asEditor(), hostOf(MERGE).host);

    expect(lens.goTo('next')).toBe(true);
    expect(editor.caretLine).toBe(2);
    lens.goTo('next');
    expect(editor.caretLine).toBe(8);
    lens.goTo('previous');
    expect(editor.caretLine).toBe(2);
  });

  it('dispose_removesEverythingItDrew', () => {
    const editor: FakeEditor = new FakeEditor(FILE);
    const drawn: ConflictLens = new ConflictLens(editor.asEditor(), hostOf(MERGE).host);

    drawn.dispose();

    expect(editor.zones.size).toBe(0);
    expect(editor.decorations).toEqual([]);
  });
});
