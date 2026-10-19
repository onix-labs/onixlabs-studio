import type * as MonacoApi from 'monaco-editor';
import { hasContent, HoverCardContent, rangeHolds } from './hover-content';

/**
 * Holds how long the pointer must rest on a symbol or a problem before its card shows, in
 * milliseconds — about half a second, as the product owner asked (#1020).
 */
export const HOVER_CARD_DELAY_MS: number = 500;

/**
 * Holds how long a card stays once the pointer leaves both the spot it is about and the card itself,
 * in milliseconds: long enough to cross from the word into the card, over whatever lies between.
 */
export const HOVER_CARD_GRACE_MS: number = 300;

/**
 * Holds Monaco's `MouseTargetType` values the card follows, written as values for an editor whose
 * window has no Monaco to read them from: the gutter's glyph margin and the text.
 */
const GLYPH_MARGIN_TARGET: MonacoApi.editor.MouseTargetType = 2;
const CONTENT_TEXT_TARGET: MonacoApi.editor.MouseTargetType = 6;

/**
 * Holds Monaco's `ScrollType.Immediate`: a card is placed once the editor has finished scrolling, and
 * a smooth scroll would close it as it scrolled.
 */
const SCROLL_IMMEDIATE: MonacoApi.editor.ScrollType = 1;

/**
 * Holds the keys that never close a card: modifiers held on their own, on the way to a chord.
 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set<string>([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
]);

/**
 * One place in an editor a card can be about: a span of the text (a word, or a problem off any word),
 * or a line's gutter.
 */
export interface HoverSpot {
  /**
   * Gets whether the spot is in the text or the gutter.
   */
  readonly kind: 'text' | 'gutter';

  /**
   * Gets the position the card is asked about, one-based: the pointer's, or the caret's.
   */
  readonly position: MonacoApi.IPosition;

  /**
   * Gets the span the card is about and placed against, one-based.
   */
  readonly anchor: MonacoApi.IRange;
}

/**
 * Where a card is placed: the box of the spot it is about, in the editor window's client pixels.
 */
export interface HoverCardOrigin {
  /**
   * Gets the box's left edge.
   */
  readonly x: number;

  /**
   * Gets the box's top edge.
   */
  readonly y: number;

  /**
   * Gets the box's width.
   */
  readonly width: number;

  /**
   * Gets the box's height: the line's.
   */
  readonly height: number;
}

/**
 * A card on screen.
 */
export interface HoverCardHandle {
  /**
   * Gets the card's element, which the pointer can move into.
   */
  readonly element: HTMLElement;

  /**
   * Takes the card away.
   */
  dispose(): void;
}

/**
 * What the card asks of the hover cards behind it.
 */
export interface HoverCardHooks {
  /**
   * Reads the problems of the editor's document, which a spot off any word can be about.
   * @returns Returns the problems.
   */
  markers(): readonly MonacoApi.editor.IMarker[];

  /**
   * Gathers what a card about a spot shows.
   * @param spot The spot.
   * @returns Returns a promise resolving to the content, or null when there is nothing to show.
   */
  content(spot: HoverSpot): Promise<HoverCardContent | null>;

  /**
   * Shows a card.
   * @param content What it shows.
   * @param spot The spot it is about.
   * @param origin Where it is placed.
   * @returns Returns the card on screen.
   */
  present(content: HoverCardContent, spot: HoverSpot, origin: HoverCardOrigin): HoverCardHandle;
}

/**
 * A card that is showing, and how it came to.
 */
interface ShownCard {
  /**
   * Gets the key of the spot it is about.
   */
  readonly key: string;

  /**
   * Gets the card on screen.
   */
  readonly handle: HoverCardHandle;

  /**
   * Gets whether the pointer or the keyboard opened it: one the keyboard opened ignores the pointer.
   */
  readonly source: 'pointer' | 'keyboard';

  /**
   * Removes the listeners on the card's element.
   */
  readonly release: () => void;
}

/**
 * Shows Studio's hover card in one Monaco editor (#1020), in place of Monaco's hover: after the pointer
 * rests on a symbol, a problem or a gutter decoration for {@link HOVER_CARD_DELAY_MS}, or at once when
 * asked from the keyboard. The card is sticky — the pointer can move into it, and it stays while the
 * pointer is in it — and goes {@link HOVER_CARD_GRACE_MS} after the pointer leaves both the spot and
 * the card. It closes at once on a click or a key in the editor, a scroll, an edit, another document,
 * the editor losing focus to anything but the card, or the window losing focus.
 *
 * Questions have no cancellation; each counts as a generation, and an answer to an older one is
 * dropped.
 */
export class HoverCardController {
  /**
   * Holds the editor the card shows in.
   */
  private readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Holds what the card asks of the hover cards behind it.
   */
  private readonly hooks: HoverCardHooks;

  /**
   * Holds the subscriptions to the editor's events.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Holds the card showing, or null when none is.
   */
  private shown: ShownCard | null = null;

  /**
   * Holds the spot the pointer rests on, waiting for its card, or null when none is waiting.
   */
  private pending: { readonly key: string; readonly timer: ReturnType<typeof setTimeout> } | null =
    null;

  /**
   * Holds the spot whose card is being asked for, and who asked, or null when no question is out.
   */
  private asking: { readonly key: string; readonly source: ShownCard['source'] } | null = null;

  /**
   * Holds the timer of the grace before a card the pointer left goes, or null when none is running.
   */
  private grace: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the spot the pointer moved to while a card was in its grace, whose own card is asked for
   * once that card has gone.
   */
  private next: HoverSpot | null = null;

  /**
   * Holds whether the pointer is in the card.
   */
  private inCard: boolean = false;

  /**
   * Counts the questions asked, so an answer to an older one is recognised and dropped.
   */
  private generation: number = 0;

  /**
   * Holds whether the controller has been disposed.
   */
  private disposed: boolean = false;

  /**
   * Holds the listener that closes the card when the editor's window loses focus.
   */
  private readonly onWindowBlur: () => void = (): void => this.hide();

  /**
   * Initializes a new instance of the {@link HoverCardController} class, following the pointer, the
   * keyboard and the editor's scroll, text and focus.
   * @param editor The editor to show the card in.
   * @param hooks What the card asks of the hover cards behind it.
   */
  public constructor(editor: MonacoApi.editor.ICodeEditor, hooks: HoverCardHooks) {
    this.editor = editor;
    this.hooks = hooks;
    this.subscriptions.push(
      editor.onMouseMove((event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onMouseMove(event),
      ),
      editor.onMouseLeave((): void => this.onPointerLeft()),
      editor.onMouseDown((): void => this.hide()),
      editor.onKeyDown((event: MonacoApi.IKeyboardEvent): void => {
        if (!MODIFIER_KEYS.has(event.browserEvent.key)) {
          this.hide();
        }
      }),
      editor.onDidScrollChange((event: MonacoApi.IScrollEvent): void => {
        if (event.scrollTopChanged || event.scrollLeftChanged) {
          this.hide();
        }
      }),
      editor.onDidChangeModelContent((): void => this.hide()),
      editor.onDidChangeModel((): void => this.hide()),
      editor.onDidBlurEditorWidget((): void => this.onEditorBlur()),
    );
  }

  /**
   * Gets whether a card is showing.
   * @returns Returns true when one is.
   */
  public isShowing(): boolean {
    return this.shown !== null;
  }

  /**
   * Shows the card about a position at once, as the keyboard asks it — ⌘K ⌘I at the caret, or F8 at
   * the problem it went to. The position is revealed first, so the card has somewhere to stand.
   * @param position The one-based position.
   * @param anchor The span the card is about, or undefined for the word or problem at the position.
   * @returns Returns a promise that resolves once the card shows, or there was nothing to show.
   */
  public async showAt(position: MonacoApi.IPosition, anchor?: MonacoApi.IRange): Promise<void> {
    this.hide();
    this.editor.revealPositionInCenterIfOutsideViewport(position, SCROLL_IMMEDIATE);
    const spot: HoverSpot = {
      kind: 'text',
      position,
      anchor: anchor ?? this.textSpot(position)?.anchor ?? emptyRange(position),
    };
    await this.open(spot, 'keyboard');
  }

  /**
   * Takes the card away, and forgets any spot waiting for one.
   */
  public hide(): void {
    this.generation += 1;
    this.asking = null;
    this.cancelPending();
    this.cancelGrace();
    this.next = null;
    this.inCard = false;
    const shown: ShownCard | null = this.shown;
    this.shown = null;
    shown?.release();
    shown?.handle.dispose();
  }

  /**
   * Stops following the editor and takes the card away.
   */
  public dispose(): void {
    this.hide();
    this.disposed = true;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  /**
   * Follows the pointer: a rest on a new spot asks for its card after the delay; leaving the spot a
   * card is about starts its grace. A card the keyboard opened ignores the pointer.
   * @param event The editor's mouse event.
   */
  private onMouseMove(event: MonacoApi.editor.IEditorMouseEvent): void {
    if (this.shown?.source === 'keyboard' || this.asking?.source === 'keyboard') {
      return;
    }
    const spot: HoverSpot | null = this.spotOf(event);
    const key: string | null = spot === null ? null : keyOf(spot);
    if (this.shown !== null) {
      if (key === this.shown.key) {
        this.cancelGrace();
        this.next = null;
        return;
      }
      this.next = spot;
      this.startGrace();
      return;
    }
    if (
      (this.pending !== null && this.pending.key === key) ||
      (this.asking !== null && this.asking.key === key)
    ) {
      return;
    }
    // The pointer has moved on from a spot whose card was being asked for: its answer is dropped.
    if (this.asking !== null) {
      this.generation += 1;
      this.asking = null;
    }
    this.cancelPending();
    if (spot !== null) {
      this.schedule(spot);
    }
  }

  /**
   * Starts a card's grace when the pointer leaves the editor — unless it is in the card — and forgets
   * any spot waiting for one.
   */
  private onPointerLeft(): void {
    this.cancelPending();
    this.next = null;
    if (this.asking?.source === 'pointer') {
      this.generation += 1;
      this.asking = null;
    }
    if (this.shown?.source === 'pointer' && !this.inCard) {
      this.startGrace();
    }
  }

  /**
   * Closes the card when the editor loses focus, unless the focus went into the card (one of its
   * buttons, pressed) or the pointer is in it — a press on a button there may not take focus, and the
   * card must still be there for the click that follows. Looked at once the focus has landed.
   */
  private onEditorBlur(): void {
    setTimeout((): void => {
      const active: Element | null = this.editor.getContainerDomNode().ownerDocument.activeElement;
      if (this.shown !== null && !this.inCard && !this.shown.handle.element.contains(active)) {
        this.hide();
      }
    });
  }

  /**
   * Asks for a spot's card once the pointer has rested on it for the delay.
   * @param spot The spot.
   */
  private schedule(spot: HoverSpot): void {
    this.pending = {
      key: keyOf(spot),
      timer: setTimeout((): void => {
        this.pending = null;
        void this.open(spot, 'pointer');
      }, HOVER_CARD_DELAY_MS),
    };
  }

  /**
   * Asks what a card about a spot shows and shows it — unless a newer question has been asked since,
   * or there is nothing to show.
   * @param spot The spot.
   * @param source Whether the pointer or the keyboard asked.
   * @returns Returns a promise that resolves once the card shows, or will not.
   */
  private async open(spot: HoverSpot, source: ShownCard['source']): Promise<void> {
    const generation: number = ++this.generation;
    this.asking = { key: keyOf(spot), source };
    let content: HoverCardContent | null;
    try {
      content = await this.hooks.content(spot);
    } catch {
      content = null;
    }
    if (this.disposed || generation !== this.generation) {
      return;
    }
    this.asking = null;
    const origin: HoverCardOrigin | null = this.originOf(spot);
    if (content === null || !hasContent(content) || origin === null) {
      return;
    }
    const handle: HoverCardHandle = this.hooks.present(content, spot, origin);
    const enter: () => void = (): void => {
      this.inCard = true;
      this.cancelGrace();
    };
    const leave: () => void = (): void => {
      this.inCard = false;
      this.next = null;
      if (this.shown?.source === 'pointer') {
        this.startGrace();
      }
    };
    // The window is listened to only while a card shows: a window that loses focus stops hearing
    // about the pointer, so the leave that would close the card never comes.
    const view: Window | null = this.editor.getContainerDomNode().ownerDocument.defaultView;
    handle.element.addEventListener('mouseenter', enter);
    handle.element.addEventListener('mouseleave', leave);
    view?.addEventListener('blur', this.onWindowBlur);
    this.shown = {
      key: keyOf(spot),
      handle,
      source,
      release: (): void => {
        handle.element.removeEventListener('mouseenter', enter);
        handle.element.removeEventListener('mouseleave', leave);
        view?.removeEventListener('blur', this.onWindowBlur);
      },
    };
  }

  /**
   * Starts the grace before the card goes, unless it is already running or the pointer is in the
   * card. When it runs out the card goes, and the spot the pointer has moved to since is asked for.
   */
  private startGrace(): void {
    if (this.grace !== null || this.inCard) {
      return;
    }
    this.grace = setTimeout((): void => {
      this.grace = null;
      const next: HoverSpot | null = this.next;
      this.hide();
      if (next !== null) {
        this.schedule(next);
      }
    }, HOVER_CARD_GRACE_MS);
  }

  /**
   * Stops the grace before the card goes.
   */
  private cancelGrace(): void {
    if (this.grace !== null) {
      clearTimeout(this.grace);
      this.grace = null;
    }
  }

  /**
   * Forgets the spot waiting for its card.
   */
  private cancelPending(): void {
    if (this.pending !== null) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  /**
   * Finds the spot under the pointer: a word or a problem in the text, or a gutter decoration with a
   * description.
   * @param event The editor's mouse event.
   * @returns Returns the spot, or null when the pointer is on nothing a card is about.
   */
  private spotOf(event: MonacoApi.editor.IEditorMouseEvent): HoverSpot | null {
    const position: MonacoApi.IPosition | null = event.target.position;
    if (position === null) {
      return null;
    }
    if (event.target.type === CONTENT_TEXT_TARGET) {
      return this.textSpot(position);
    }
    if (
      event.target.type === GLYPH_MARGIN_TARGET &&
      glyphMessages(this.editor, position.lineNumber).length > 0
    ) {
      const line: number = position.lineNumber;
      return {
        kind: 'gutter',
        position: { lineNumber: line, column: 1 },
        anchor: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      };
    }
    return null;
  }

  /**
   * Finds the spot of the text at a position: the word there, or else the first problem it is on.
   * @param position The one-based position.
   * @returns Returns the spot, or null when the position is on neither.
   */
  private textSpot(position: MonacoApi.IPosition): HoverSpot | null {
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    const word: MonacoApi.editor.IWordAtPosition | null =
      model?.getWordAtPosition(position) ?? null;
    if (word !== null) {
      return {
        kind: 'text',
        position,
        anchor: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        },
      };
    }
    const problem: MonacoApi.editor.IMarker | undefined = this.hooks
      .markers()
      .find((marker: MonacoApi.editor.IMarker): boolean => rangeHolds(marker, position));
    return problem === undefined
      ? null
      : {
          kind: 'text',
          position,
          anchor: {
            startLineNumber: problem.startLineNumber,
            startColumn: problem.startColumn,
            endLineNumber: problem.endLineNumber,
            endColumn: problem.endColumn,
          },
        };
  }

  /**
   * Measures where a card about a spot is placed: the box of the span's first line, from its start to
   * its end on that line — or the glyph margin's cell, for the gutter — in client pixels.
   * @param spot The spot.
   * @returns Returns the box, or null when the spot is not on screen.
   */
  private originOf(spot: HoverSpot): HoverCardOrigin | null {
    const start: { top: number; left: number; height: number } | null =
      this.editor.getScrolledVisiblePosition({
        lineNumber: spot.anchor.startLineNumber,
        column: spot.anchor.startColumn,
      });
    if (start === null) {
      return null;
    }
    const box: DOMRect = this.editor.getContainerDomNode().getBoundingClientRect();
    if (spot.kind === 'gutter') {
      const layout: MonacoApi.editor.EditorLayoutInfo = this.editor.getLayoutInfo();
      return {
        x: box.left + layout.glyphMarginLeft,
        y: box.top + start.top,
        width: layout.glyphMarginWidth,
        height: start.height,
      };
    }
    const end: { left: number } | null =
      spot.anchor.endLineNumber === spot.anchor.startLineNumber
        ? this.editor.getScrolledVisiblePosition({
            lineNumber: spot.anchor.startLineNumber,
            column: spot.anchor.endColumn,
          })
        : null;
    return {
      x: box.left + start.left,
      y: box.top + start.top,
      width: Math.max(0, (end?.left ?? start.left) - start.left),
      height: start.height,
    };
  }
}

/**
 * Lists the descriptions of a line's gutter decorations — a breakpoint's, say — which a card over the
 * gutter shows.
 * @param editor The editor.
 * @param line The one-based line.
 * @returns Returns the descriptions, as Monaco's markdown strings.
 */
export function glyphMessages(
  editor: MonacoApi.editor.ICodeEditor,
  line: number,
): MonacoApi.IMarkdownString[] {
  const messages: MonacoApi.IMarkdownString[] = [];
  for (const decoration of editor.getLineDecorations(line) ?? []) {
    const message: MonacoApi.IMarkdownString | MonacoApi.IMarkdownString[] | null | undefined =
      decoration.options.glyphMarginHoverMessage;
    if (message !== null && message !== undefined) {
      messages.push(...(Array.isArray(message) ? message : [message]));
    }
  }
  return messages;
}

/**
 * Names the class of the link decoration Monaco puts on a symbol while ⌘ (Ctrl) is held.
 */
export const GOTO_DEFINITION_LINK_CLASS: string = 'goto-definition-link';

/**
 * Lists the hover messages of the decorations on a position in the text — Monaco's definition preview
 * while ⌘ is held, say — which a card about the position shows after the providers' answers, as
 * Monaco's own hover did.
 * @param editor The editor.
 * @param position The one-based position.
 * @returns Returns the messages, as Monaco's markdown strings.
 */
export function decorationMessages(
  editor: MonacoApi.editor.ICodeEditor,
  position: MonacoApi.IPosition,
): MonacoApi.IMarkdownString[] {
  const messages: MonacoApi.IMarkdownString[] = [];
  for (const decoration of editor.getLineDecorations(position.lineNumber) ?? []) {
    const message: MonacoApi.IMarkdownString | MonacoApi.IMarkdownString[] | null | undefined =
      decoration.options.hoverMessage;
    // Monaco's ⌘-click link decoration says "Click to show N definitions"; ⌘-click is Studio's now,
    // so that line describes a gesture Monaco no longer answers, and is left out.
    const link: boolean = (decoration.options.inlineClassName ?? '').includes(
      GOTO_DEFINITION_LINK_CLASS,
    );
    if (
      !link &&
      message !== null &&
      message !== undefined &&
      rangeHolds(decoration.range, position)
    ) {
      messages.push(...(Array.isArray(message) ? message : [message]));
    }
  }
  return messages;
}

/**
 * Builds the key a spot is told apart by: its kind and its span.
 * @param spot The spot.
 * @returns Returns the key.
 */
function keyOf(spot: HoverSpot): string {
  const range: MonacoApi.IRange = spot.anchor;
  return `${spot.kind}:${range.startLineNumber}:${range.startColumn}:${range.endLineNumber}:${range.endColumn}`;
}

/**
 * Builds an empty span at a position.
 * @param position The one-based position.
 * @returns Returns the span.
 */
function emptyRange(position: MonacoApi.IPosition): MonacoApi.IRange {
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
}
