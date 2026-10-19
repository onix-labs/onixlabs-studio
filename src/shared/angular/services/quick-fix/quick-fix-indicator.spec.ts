import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import {
  QUICK_FIX_GLYPH_CLASS,
  QUICK_FIX_INDICATOR_DELAY_MS,
  QuickFixIndicator,
  QuickFixIndicatorHooks,
} from './quick-fix-indicator';

/**
 * Monaco's `MouseTargetType.GUTTER_GLYPH_MARGIN` and `CONTENT_TEXT`, as the fake instance numbers them.
 */
const GLYPH_MARGIN: number = 2;
const CONTENT_TEXT: number = 6;

/**
 * Monaco's glyph-margin lanes, as the fake instance numbers them.
 */
const CENTER_LANE: number = 2;
const RIGHT_LANE: number = 3;

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * A stand-in editor, what was done to it, and the events it can raise.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
  decorations(): MonacoApi.editor.IModelDeltaDecoration[];
  press(
    line: number,
    options?: { type?: number; lane?: number; right?: boolean },
  ): { prevented: boolean };
  moveTo(line: number, column: number): void;
  type(): void;
  reconfigure(): void;
  markersChanged(uri: string): void;
  listening(): number;
}

/**
 * Builds a stand-in editor over the given lines.
 * @param lines The model's lines.
 * @returns Returns the editor, its recorders and its events.
 */
function fakeEditor(lines: readonly string[]): FakeEditor {
  const calls: string[] = [];
  let position: MonacoApi.IPosition = { lineNumber: 1, column: 1 };
  const listeners: Map<string, (event: unknown) => void> = new Map<
    string,
    (event: unknown) => void
  >();
  const subscribe: (
    name: string,
  ) => (listener: (event: unknown) => void) => MonacoApi.IDisposable =
    (name: string) =>
    (listener: (event: unknown) => void): MonacoApi.IDisposable => {
      listeners.set(name, listener);
      return { dispose: (): void => void listeners.delete(name) };
    };
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLineCount: (): number => lines.length,
  };
  let decorations: MonacoApi.editor.IModelDeltaDecoration[] = [];
  const collection: unknown = {
    set: (next: MonacoApi.editor.IModelDeltaDecoration[]): void => {
      decorations = next;
      calls.push(
        `set ${next.map((d: MonacoApi.editor.IModelDeltaDecoration) => d.range.startLineNumber).join(',')}`,
      );
    },
    clear: (): void => {
      decorations = [];
      calls.push('clear');
    },
  };
  const editor: unknown = {
    getModel: (): unknown => model,
    getPosition: (): MonacoApi.IPosition => position,
    createDecorationsCollection: (): unknown => collection,
    onDidChangeCursorPosition: subscribe('cursor'),
    onDidChangeModelContent: subscribe('content'),
    onDidChangeModel: subscribe('model'),
    onDidChangeConfiguration: subscribe('configuration'),
    onMouseDown: subscribe('mouse'),
    onMouseUp: subscribe('mouseup'),
  };
  return {
    editor: editor as MonacoApi.editor.ICodeEditor,
    calls,
    decorations: (): MonacoApi.editor.IModelDeltaDecoration[] => decorations,
    press: (
      line: number,
      options: { type?: number; lane?: number; right?: boolean } = {},
    ): { prevented: boolean } => {
      const result: { prevented: boolean } = { prevented: false };
      // A press is a button going down and coming back up at the same place.
      const event: unknown = {
        target: {
          type: options.type ?? GLYPH_MARGIN,
          position: { lineNumber: line, column: 1 },
          detail: { glyphMarginLane: options.lane ?? RIGHT_LANE },
        },
        event: {
          leftButton: !(options.right ?? false),
          rightButton: options.right ?? false,
          preventDefault: (): void => void (result.prevented = true),
          stopPropagation: (): void => undefined,
        },
      };
      listeners.get('mouse')?.(event);
      listeners.get('mouseup')?.(event);
      return result;
    },
    moveTo: (line: number, column: number): void => {
      position = { lineNumber: line, column };
      listeners.get('cursor')?.({ position });
    },
    type: (): void => listeners.get('content')?.({}),
    reconfigure: (): void => listeners.get('configuration')?.({}),
    markersChanged: (uri: string): void =>
      listeners.get('markers')?.([{ toString: (): string => uri }]),
    listening: (): number => listeners.size,
  };
}

/**
 * A fake Monaco instance: only the enumerations the icon reads.
 */
const monaco: typeof MonacoApi = {
  editor: {
    MouseTargetType: { GUTTER_GLYPH_MARGIN: GLYPH_MARGIN, CONTENT_TEXT },
    GlyphMarginLane: { Left: 1, Center: CENTER_LANE, Right: RIGHT_LANE },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
  },
} as unknown as typeof MonacoApi;

describe('QuickFixIndicator (#1016)', () => {
  let fixes: boolean;
  let enabled: boolean;
  let asked: number;
  let opened: number;
  let fake: FakeEditor;
  let indicator: QuickFixIndicator;

  /**
   * Builds the icon over the fake editor.
   * @param lines The model's lines.
   * @returns Returns the icon.
   */
  function build(lines: readonly string[] = ['    broken();', 'x', 'done();']): QuickFixIndicator {
    fake = fakeEditor(lines);
    const markerListeners: ((uris: readonly MonacoApi.Uri[]) => void)[] = [];
    const hooks: QuickFixIndicatorHooks = {
      hasFixes: (): Promise<boolean> => {
        asked += 1;
        return Promise.resolve(fixes);
      },
      open: (): void => void (opened += 1),
      enabled: (): boolean => enabled,
      onMarkersChanged: (
        listener: (uris: readonly MonacoApi.Uri[]) => void,
      ): MonacoApi.IDisposable => {
        markerListeners.push(listener);
        return { dispose: (): void => void markerListeners.pop() };
      },
    };
    indicator = new QuickFixIndicator(fake.editor, monaco, hooks);
    fake.markersChanged = (uri: string): void =>
      markerListeners.forEach((listener: (uris: readonly MonacoApi.Uri[]) => void): void =>
        listener([{ toString: (): string => uri } as MonacoApi.Uri]),
      );
    return indicator;
  }

  /**
   * Lets the icon's wait run out and its question be answered.
   * @returns Returns a promise that resolves once the answer has been acted on.
   */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(QUICK_FIX_INDICATOR_DELAY_MS);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fixes = true;
    enabled = true;
    asked = 0;
    opened = 0;
  });

  afterEach(() => {
    indicator.dispose();
    vi.useRealTimers();
  });

  it('asksNothingUntilTheCaretMoves_thenOnceItHasStayedStill', async () => {
    build();
    await settle();
    expect(asked).toBe(0);

    fake.moveTo(1, 6);
    fake.moveTo(1, 7);
    fake.moveTo(1, 8);
    await settle();

    expect(asked).toBe(1);
  });

  it('showsInTheGlyphMarginsRightLane_onTheCaretsLine_whenFixesExistThere', async () => {
    build();

    fake.moveTo(3, 2);
    await settle();

    expect(indicator.shownLine()).toBe(3);
    expect(fake.calls).toEqual(['set 3']);
    const [decoration] = fake.decorations();
    expect(decoration.range).toEqual({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 1,
    });
    expect(decoration.options.glyphMargin).toEqual({ position: RIGHT_LANE });
    // Drawn from Studio's icon set, not Monaco's codicon, and in the gutter rather than the text.
    expect(decoration.options.glyphMarginClassName).toBe(
      `${Icon.QUICK_FIX.classList} ${QUICK_FIX_GLYPH_CLASS}`,
    );
    expect(decoration.options.glyphMarginClassName).not.toContain('codicon');
    expect(decoration.options.className).toBeUndefined();
    expect(decoration.options.afterContentClassName).toBeUndefined();
    expect(decoration.options.glyphMarginHoverMessage).toBeUndefined();
  });

  it('hidesWhenTheCaretLeavesItsLine_orTheTextChanges_andWhereNoFixesExist', async () => {
    build();
    fake.moveTo(1, 6);
    await settle();

    fake.moveTo(2, 1);
    expect(indicator.shownLine()).toBeNull();
    fixes = false;
    await settle();
    expect(indicator.shownLine()).toBeNull();

    fixes = true;
    fake.moveTo(1, 2);
    await settle();
    expect(indicator.shownLine()).toBe(1);
    fake.type();
    expect(indicator.shownLine()).toBeNull();
  });

  it('dropsAnAnswerToAnOlderQuestion', async () => {
    build();
    let answer: (value: boolean) => void = (): void => undefined;
    let first: boolean = true;
    (indicator as unknown as { hooks: QuickFixIndicatorHooks }).hooks.hasFixes =
      (): Promise<boolean> =>
        first
          ? new Promise<boolean>((resolve: (value: boolean) => void): void => {
              first = false;
              answer = resolve;
            })
          : Promise.resolve(false);

    fake.moveTo(1, 6);
    await settle();
    fake.moveTo(1, 7);
    answer(true);
    await Promise.resolve();

    expect(indicator.shownLine()).toBeNull();
  });

  it('neverShowsWhereFixesCannotBeOffered_asInAReadOnlyEditor', async () => {
    build();
    enabled = false;

    fake.moveTo(1, 6);
    await settle();
    fake.press(1);

    expect(asked).toBe(0);
    expect(indicator.shownLine()).toBeNull();
    expect(fake.calls).toEqual([]);
    expect(opened).toBe(0);
  });

  it('becomingReadOnly_hidesTheIcon', async () => {
    build();
    fake.moveTo(1, 6);
    await settle();

    enabled = false;
    fake.reconfigure();

    expect(indicator.shownLine()).toBeNull();
  });

  it('asksAgainWhenTheProblemsOfItsOwnDocumentChange', async () => {
    build();

    fake.markersChanged('inmemory://model/other');
    await settle();
    expect(asked).toBe(0);
    fake.markersChanged(MODEL_URI);
    await settle();

    expect(asked).toBe(1);
  });

  it('pressingTheIcon_opensTheMenu_andKeepsThePressFromTheEditor', async () => {
    build();
    fake.moveTo(1, 6);
    await settle();

    const press: { prevented: boolean } = fake.press(1);

    expect(press.prevented).toBe(true);
    // ⛔ Not while the click is still under way: a menu opened then took the click that follows the
    // release as a click away, and closed as the button came up (Matthew's live test of #1016).
    expect(opened).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toBe(1);
  });

  it('pressesElsewhere_doNotOpenTheMenu', async () => {
    build();
    fake.press(1);
    expect(opened).toBe(0);

    fake.moveTo(1, 6);
    await settle();
    // The centre lane (a breakpoint's), another line, the text, and the secondary button.
    expect(fake.press(1, { lane: CENTER_LANE }).prevented).toBe(false);
    fake.press(2);
    fake.press(1, { type: CONTENT_TEXT });
    fake.press(1, { right: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(opened).toBe(0);
  });

  it('dispose_stopsFollowingTheEditor_andTakesTheIconAway', async () => {
    build();
    fake.moveTo(1, 6);
    await settle();

    indicator.dispose();

    expect(fake.calls.at(-1)).toBe('clear');
    expect(fake.decorations()).toEqual([]);
    expect(fake.listening()).toBe(0);
  });
});
