import type * as MonacoApi from 'monaco-editor';
import {
  decorationMessages,
  glyphMessages,
  HOVER_CARD_DELAY_MS,
  HOVER_CARD_GRACE_MS,
  HoverCardController,
  HoverCardHandle,
  HoverCardHooks,
  HoverCardOrigin,
  HoverSpot,
} from './hover-card-controller';
import { HoverCardContent, MARKER_SEVERITY } from './hover-content';

/**
 * Monaco's `MouseTargetType` values, as the fake editor numbers them.
 */
const GLYPH_MARGIN: number = 2;
const CONTENT_TEXT: number = 6;
const CONTENT_EMPTY: number = 7;

/**
 * The width of a character in the fake editor, and the height of a line, in pixels.
 */
const CHAR: number = 10;
const LINE: number = 20;

/**
 * The fake editor's container's offset in the window.
 */
const BOX: { left: number; top: number } = { left: 100, top: 50 };

/**
 * A stand-in editor and the events it can raise.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly container: HTMLElement;
  readonly revealed: MonacoApi.IPosition[];
  move(line: number, column: number, type?: number): void;
  raise(name: string, event?: unknown): void;
  key(key: string): void;
  listening(): number;
  decorations: MonacoApi.editor.IModelDecoration[];
}

/**
 * Builds a stand-in editor over the given lines, whose words are runs of letters.
 * @param lines The model's lines.
 * @returns Returns the editor and its events.
 */
function fakeEditor(lines: readonly string[]): FakeEditor {
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
  const container: HTMLElement = document.createElement('div');
  container.getBoundingClientRect = (): DOMRect =>
    ({ left: BOX.left, top: BOX.top, width: 800, height: 600 }) as DOMRect;
  document.body.appendChild(container);
  const revealed: MonacoApi.IPosition[] = [];
  const fake: FakeEditor = {
    editor: null as unknown as MonacoApi.editor.ICodeEditor,
    container,
    revealed,
    decorations: [],
    move: (line: number, column: number, type: number = CONTENT_TEXT): void =>
      listeners.get('move')?.({ target: { type, position: { lineNumber: line, column } } }),
    raise: (name: string, event: unknown = {}): void => listeners.get(name)?.(event),
    key: (key: string): void => listeners.get('key')?.({ browserEvent: { key } }),
    listening: (): number => listeners.size,
  };
  const model: unknown = {
    getWordAtPosition: (position: MonacoApi.IPosition): MonacoApi.editor.IWordAtPosition | null => {
      const text: string = lines[position.lineNumber - 1] ?? '';
      for (const match of text.matchAll(/[A-Za-z]+/g)) {
        const start: number = (match.index ?? 0) + 1;
        const end: number = start + match[0].length;
        if (position.column >= start && position.column <= end) {
          return { word: match[0], startColumn: start, endColumn: end };
        }
      }
      return null;
    },
  };
  (fake as { editor: unknown }).editor = {
    getModel: (): unknown => model,
    getContainerDomNode: (): HTMLElement => container,
    getScrolledVisiblePosition: (
      position: MonacoApi.IPosition,
    ): { top: number; left: number; height: number } => ({
      top: (position.lineNumber - 1) * LINE,
      left: 60 + (position.column - 1) * CHAR,
      height: LINE,
    }),
    getLayoutInfo: (): unknown => ({ glyphMarginLeft: 4, glyphMarginWidth: 18 }),
    getLineDecorations: (line: number): MonacoApi.editor.IModelDecoration[] =>
      fake.decorations.filter(
        (decoration: MonacoApi.editor.IModelDecoration): boolean =>
          decoration.range.startLineNumber === line,
      ),
    revealPositionInCenterIfOutsideViewport: (position: MonacoApi.IPosition): void =>
      void revealed.push(position),
    onMouseMove: subscribe('move'),
    onMouseLeave: subscribe('leave'),
    onMouseDown: subscribe('down'),
    onKeyDown: subscribe('key'),
    onDidScrollChange: subscribe('scroll'),
    onDidChangeModelContent: subscribe('content'),
    onDidChangeModel: subscribe('model'),
    onDidBlurEditorWidget: subscribe('blur'),
  };
  return fake;
}

/**
 * One card the controller presented.
 */
interface Presented {
  readonly content: HoverCardContent;
  readonly spot: HoverSpot;
  readonly origin: HoverCardOrigin;
  readonly element: HTMLElement;
  disposed: boolean;
}

describe('HoverCardController (#1020)', () => {
  let fake: FakeEditor;
  let controller: HoverCardController;
  let asked: HoverSpot[];
  let presented: Presented[];
  let answers: Map<string, Promise<HoverCardContent | null>>;
  let markers: MonacoApi.editor.IMarker[];

  /**
   * Builds the content a card about a spot shows by default: one section naming the spot.
   * @param spot The spot.
   * @returns Returns the content.
   */
  function contentFor(spot: HoverSpot): HoverCardContent {
    return {
      sections: [`about ${spot.anchor.startLineNumber}:${spot.anchor.startColumn}`],
      problems: [],
      quickFix: false,
      actions: null,
    };
  }

  /**
   * Builds the controller over a fake editor.
   * @param lines The model's lines.
   */
  function build(lines: readonly string[] = ['alpha beta', '    gamma', '']): void {
    fake = fakeEditor(lines);
    const hooks: HoverCardHooks = {
      markers: (): readonly MonacoApi.editor.IMarker[] => markers,
      content: (spot: HoverSpot): Promise<HoverCardContent | null> => {
        asked.push(spot);
        return (
          answers.get(`${spot.position.lineNumber}:${spot.position.column}`) ??
          Promise.resolve(contentFor(spot))
        );
      },
      present: (
        content: HoverCardContent,
        spot: HoverSpot,
        origin: HoverCardOrigin,
      ): HoverCardHandle => {
        const element: HTMLElement = document.createElement('div');
        element.tabIndex = 0;
        document.body.appendChild(element);
        const card: Presented = { content, spot, origin, element, disposed: false };
        presented.push(card);
        return {
          element,
          dispose: (): void => {
            card.disposed = true;
            element.remove();
          },
        };
      },
    };
    controller = new HoverCardController(fake.editor, hooks);
  }

  /**
   * Counts the cards showing.
   * @returns Returns how many are.
   */
  function showing(): number {
    return presented.filter((card: Presented): boolean => !card.disposed).length;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    asked = [];
    presented = [];
    answers = new Map();
    markers = [];
  });

  afterEach(() => {
    controller.dispose();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('restingOnAWord_showsItsCardAfterTheDelay_aboveTheWord', async () => {
    build();
    fake.move(1, 8);

    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS - 1);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(asked).toEqual([
      {
        kind: 'text',
        position: { lineNumber: 1, column: 8 },
        anchor: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 11 },
      },
    ]);
    expect(presented).toHaveLength(1);
    // The word's box: from its start to its end, on its line, in the window's pixels.
    expect(presented[0].origin).toEqual({
      x: BOX.left + 60 + 6 * CHAR,
      y: BOX.top,
      width: 4 * CHAR,
      height: LINE,
    });
    expect(controller.isShowing()).toBe(true);
  });

  it('movingWithinTheWord_keepsWaiting_andMovingOffEverything_waitsForNothing', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS - 100);
    fake.move(1, 4);
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toHaveLength(1);

    controller.hide();
    asked = [];
    fake.move(2, 2);
    fake.move(3, 1, CONTENT_EMPTY);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS * 2);
    expect(asked).toEqual([]);
    expect(showing()).toBe(0);
  });

  it('aLateAnswer_forASpotThePointerLeft_isDropped', async () => {
    build();
    let answer!: (content: HoverCardContent | null) => void;
    answers.set(
      '1:2',
      new Promise<HoverCardContent | null>(
        (resolve: (content: HoverCardContent | null) => void): void => {
          answer = resolve;
        },
      ),
    );
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    fake.move(1, 8);
    answer({ sections: ['stale'], problems: [], quickFix: false, actions: null });
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(presented.map((card: Presented): readonly string[] => card.content.sections)).toEqual([
      ['about 1:7'],
    ]);
  });

  it('nothingToShow_showsNoCard', async () => {
    build();
    answers.set('1:2', Promise.resolve(null));
    answers.set(
      '1:8',
      Promise.resolve({
        sections: [],
        problems: [],
        quickFix: false,
        actions: { definition: true, references: true, referencesListed: true },
      }),
    );
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    fake.move(1, 8);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(asked).toHaveLength(2);
    expect(presented).toEqual([]);
  });

  it('isSticky_thePointerCanCrossIntoTheCard_andItGoesAGraceAfterLeavingBoth', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    const card: Presented = presented[0];

    // Off the word, across the gap, into the card within the grace.
    fake.move(2, 7);
    fake.raise('leave');
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS - 50);
    card.element.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS * 3);
    expect(card.disposed).toBe(false);

    card.element.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS - 1);
    expect(card.disposed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(card.disposed).toBe(true);
    expect(controller.isShowing()).toBe(false);
  });

  it('comingBackToTheWordInTheGrace_keepsTheCard', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    fake.move(1, 8);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS - 10);
    fake.move(1, 3);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS * 3);

    expect(presented).toHaveLength(1);
    expect(showing()).toBe(1);
  });

  it('restingOnAnotherWord_replacesTheCard_onceTheGraceAndTheDelayHavePassed', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    fake.move(1, 8);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_GRACE_MS);
    expect(showing()).toBe(0);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(presented.map((card: Presented): number => card.spot.anchor.startColumn)).toEqual([
      1, 7,
    ]);
    expect(showing()).toBe(1);
  });

  it('aProblemOffAnyWord_isASpotOfItsOwn_anchoredOnTheProblem', async () => {
    build(['alpha  ;']);
    markers = [
      {
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 9,
        severity: MARKER_SEVERITY.error,
        message: 'Expected an expression',
      } as MonacoApi.editor.IMarker,
    ];
    fake.move(1, 8);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(asked[0].anchor).toEqual({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 9,
    });
  });

  it('aGutterDecorationWithADescription_showsItsCard_besideTheGlyphMargin', async () => {
    build();
    fake.decorations = [
      {
        id: 'b',
        ownerId: 0,
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
        options: { glyphMarginHoverMessage: { value: 'Breakpoint' } },
      } as MonacoApi.editor.IModelDecoration,
    ];
    fake.move(1, 1, GLYPH_MARGIN);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    expect(asked).toEqual([]);

    fake.move(2, 1, GLYPH_MARGIN);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(asked[0].kind).toBe('gutter');
    expect(presented[0].origin).toEqual({
      x: BOX.left + 4,
      y: BOX.top + LINE,
      width: 18,
      height: LINE,
    });
    expect(glyphMessages(fake.editor, 2)).toEqual([{ value: 'Breakpoint' }]);
  });

  it('decorationMessages_areTheHoverMessagesOfTheDecorationsOnThePosition', () => {
    build();
    fake.decorations = [
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
        options: { hoverMessage: [{ value: 'one' }, { value: 'two' }] },
      } as MonacoApi.editor.IModelDecoration,
      {
        range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 11 },
        options: { hoverMessage: { value: 'elsewhere' } },
      } as MonacoApi.editor.IModelDecoration,
      // Monaco's ⌘-click link: ⌘-click is Studio's, so its "Click to show…" line is left out.
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
        options: {
          inlineClassName: 'goto-definition-link',
          hoverMessage: { value: 'Click to show 2 definitions.' },
        },
      } as MonacoApi.editor.IModelDecoration,
    ];

    expect(decorationMessages(fake.editor, { lineNumber: 1, column: 3 })).toEqual([
      { value: 'one' },
      { value: 'two' },
    ]);
  });

  it('showAt_opensAtOnce_revealingThePosition_andIgnoresThePointer_untilAKey', async () => {
    build();
    await controller.showAt({ lineNumber: 2, column: 6 });

    expect(fake.revealed).toEqual([{ lineNumber: 2, column: 6 }]);
    expect(asked[0].anchor).toEqual({
      startLineNumber: 2,
      startColumn: 5,
      endLineNumber: 2,
      endColumn: 10,
    });
    fake.move(1, 2);
    fake.raise('leave');
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS * 3);
    expect(presented).toHaveLength(1);
    expect(showing()).toBe(1);

    fake.key('Meta');
    expect(showing()).toBe(1);
    fake.key('Escape');
    expect(showing()).toBe(0);
  });

  it('showAt_withASpan_isAnchoredOnTheSpan', async () => {
    build();
    const problem: MonacoApi.IRange = {
      startLineNumber: 1,
      startColumn: 3,
      endLineNumber: 1,
      endColumn: 9,
    };
    await controller.showAt({ lineNumber: 1, column: 3 }, problem);

    expect(asked[0].anchor).toEqual(problem);
  });

  it.each([
    ['a click in the editor', 'down', {}],
    ['a scroll', 'scroll', { scrollTopChanged: true, scrollLeftChanged: false }],
    ['an edit', 'content', {}],
    ['another document', 'model', {}],
  ])('closesOn %s', async (_label: string, name: string, event: unknown) => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    fake.raise('scroll', { scrollTopChanged: false, scrollLeftChanged: false });
    expect(showing()).toBe(1);
    fake.raise(name, event);
    expect(showing()).toBe(0);
  });

  it('closesWhenTheEditorLosesFocus_unlessTheFocusOrThePointerIsInTheCard', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);
    presented[0].element.focus();
    fake.raise('blur');
    await vi.advanceTimersByTimeAsync(0);
    expect(showing()).toBe(1);

    presented[0].element.blur();
    presented[0].element.dispatchEvent(new MouseEvent('mouseenter'));
    fake.raise('blur');
    await vi.advanceTimersByTimeAsync(0);
    expect(showing()).toBe(1);

    presented[0].element.dispatchEvent(new MouseEvent('mouseleave'));
    fake.raise('blur');
    await vi.advanceTimersByTimeAsync(0);
    expect(showing()).toBe(0);
  });

  it('closesWhenTheWindowLosesFocus', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    window.dispatchEvent(new Event('blur'));

    expect(showing()).toBe(0);
  });

  it('dispose_stopsFollowingTheEditor_andTakesTheCardAway', async () => {
    build();
    fake.move(1, 2);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    controller.dispose();
    fake.move(1, 8);
    await vi.advanceTimersByTimeAsync(HOVER_CARD_DELAY_MS);

    expect(showing()).toBe(0);
    expect(fake.listening()).toBe(0);
    expect(presented).toHaveLength(1);
  });
});
