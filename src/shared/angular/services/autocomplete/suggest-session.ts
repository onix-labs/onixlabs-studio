import type * as MonacoApi from 'monaco-editor';
import type {
  CompletionListView,
  CompletionPlacement,
} from '@shared/angular/components/completion-list/completion-list';
import { VISIBLE_ROWS } from '@shared/angular/components/completion-list/completion-list';
import {
  COMPOSING_CONTEXT_KEY,
  SUGGEST_FOCUSED_CONTEXT_KEY,
  SUGGEST_VISIBLE_CONTEXT_KEY,
  SuggestControl,
  SuggestItem,
  SuggestList,
  SuggestMove,
} from '@shared/angular/services/monaco/monaco-suggest-commands';
import { isStudioProvider } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { canResolve, CompletionDetails, CompletionRow, detailsOf, rowOf } from './completion-rows';

/**
 * Holds what the list says while a session the user asked for awaits its first answer.
 */
export const LOADING_MESSAGE: string = 'Loading…';

/**
 * Holds what the list says when a session the user asked for finds nothing.
 */
export const EMPTY_MESSAGE: string = 'No suggestions.';

/**
 * Holds Monaco's `EditorOption.acceptSuggestionOnCommitCharacter`.
 */
const ACCEPT_ON_COMMIT_CHARACTER: MonacoApi.editor.EditorOption = 0;

/**
 * Holds how far left of the word's start the list is placed, in pixels, so its labels — after each
 * row's icon — line up under the word being typed.
 */
const LABEL_INSET_PX: number = 24;

/**
 * Holds how wide the list and its details pane are together, in pixels at the default root font size:
 * with less room than this right of the word, the pane goes under the list.
 */
const SIDE_BY_SIDE_PX: number = 772;

/**
 * A box in the window's client pixels: the line a list or card is placed against.
 */
export interface EditorOrigin {
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
   * Gets the box's height.
   */
  readonly height: number;
}

/**
 * The list on screen, as a session drives it.
 */
export interface CompletionSurface {
  /**
   * Shows what the list shows.
   * @param view The list's view.
   */
  update(view: CompletionListView): void;

  /**
   * Places the list against a line, or hides it while the line is out of sight.
   * @param origin The line's box, or null when it cannot be seen.
   */
  place(origin: EditorOrigin | null): void;

  /**
   * Takes the list away.
   */
  dispose(): void;
}

/**
 * A cancellable request, in Monaco's shape.
 */
export interface Cancellation {
  /**
   * Gets the token a request watches.
   */
  readonly token: MonacoApi.CancellationToken;

  /**
   * Cancels the request.
   */
  cancel(): void;

  /**
   * Releases the source.
   */
  dispose(): void;
}

/**
 * What a session needs from its host: the list's surface, the frame and timer it batches through, and
 * Monaco's cancellation.
 */
export interface SuggestSessionHost {
  /**
   * Puts the list on screen.
   * @param origin The line it is placed against.
   * @param chosen Receives the index of a row clicked.
   * @returns Returns the surface.
   */
  present(origin: EditorOrigin, chosen: (index: number) => void): CompletionSurface;

  /**
   * Runs a function at the next frame.
   * @param run The function.
   * @returns Returns a function that cancels it.
   */
  frame(run: () => void): () => void;

  /**
   * Runs a function after a delay.
   * @param run The function.
   * @param delay The delay, in milliseconds.
   * @returns Returns a function that cancels it.
   */
  delay(run: () => void, delay: number): () => void;

  /**
   * Makes a cancellation, of the editor's Monaco.
   * @returns Returns the cancellation.
   */
  cancellation(): Cancellation;
}

/**
 * The editor's private ways to name the text area's active descendant, which Monaco's own list used.
 */
interface AriaEditor {
  /**
   * Sets the text area's accessibility options.
   */
  setAriaOptions?: (options: { activeDescendant: string | undefined }) => void;

  /**
   * Gets the event raised before typed text is inserted.
   */
  onWillType?: (listener: (text: string) => void) => MonacoApi.IDisposable;
}

/**
 * Counts the sessions made, so each list's element identifiers are unique.
 */
let sessions: number = 0;

/**
 * Drives Studio's completion list in one editor (#1021), from Monaco's suggest model: the model says a
 * session started, sends its answers as the user types, and says it ended; the list shows them, keeps
 * which row is focused, moves it for the keys, accepts it through the model's own insertion, and shows
 * its details — filled in by the provider when the provider can.
 *
 * The editor keeps the keyboard throughout. Its context keys say while the list shows and while a row
 * is focused, which is when the list's keys reach it; and while an input method composes, which is
 * when none of them do — Enter then commits the composition, never a completion. Drawing is batched to
 * one update a frame, and a provider's late answer for a row no longer focused is dropped.
 */
export class SuggestSession {
  /**
   * Holds the session of Monaco's suggest model the list shows, or null when none runs.
   */
  private control: SuggestControl | null = null;

  /**
   * Holds the items listed, best first.
   */
  private items: readonly SuggestItem[] = [];

  /**
   * Holds the rows built for the items, by index, for the answer shown.
   */
  private rows: Map<number, CompletionRow> = new Map<number, CompletionRow>();

  /**
   * Holds the focused row's index, or -1 for none.
   */
  private focused: number = -1;

  /**
   * Holds what the list says when it has no rows, or null.
   */
  private message: string | null = null;

  /**
   * Holds whether the list shows.
   */
  private visible: boolean = false;

  /**
   * Holds whether the answer shown is frozen, awaiting the provider's next.
   */
  private frozen: boolean = false;

  /**
   * Holds whether an input method is composing.
   */
  private composing: boolean = false;

  /**
   * Holds the list on screen, or null before it first draws.
   */
  private surface: CompletionSurface | null = null;

  /**
   * Holds the function that cancels the pending frame, or null when none is pending.
   */
  private pendingFrame: (() => void) | null = null;

  /**
   * Holds the function that cancels the pending "Loading…", or null.
   */
  private pendingLoading: (() => void) | null = null;

  /**
   * Holds the provider's request to fill in the focused item, or null.
   */
  private resolving: Cancellation | null = null;

  /**
   * Holds the context key that says the list shows.
   */
  private readonly visibleKey: MonacoApi.editor.IContextKey<boolean>;

  /**
   * Holds the context key that says a row is focused.
   */
  private readonly focusedKey: MonacoApi.editor.IContextKey<boolean>;

  /**
   * Holds the context key that says an input method is composing.
   */
  private readonly composingKey: MonacoApi.editor.IContextKey<boolean>;

  /**
   * Holds the editor subscriptions, released with the session.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Holds the prefix of the list's element identifiers.
   */
  private readonly idPrefix: string = `studio-completion-${(sessions += 1)}`;

  /**
   * Initializes a new instance of the {@link SuggestSession} class: makes the editor's context keys,
   * and follows its input method, its scrolling and its typing (for commit characters).
   * @param editor The editor.
   * @param host The host.
   */
  public constructor(
    private readonly editor: MonacoApi.editor.ICodeEditor,
    private readonly host: SuggestSessionHost,
  ) {
    this.visibleKey = contextKey(editor, SUGGEST_VISIBLE_CONTEXT_KEY);
    this.focusedKey = contextKey(editor, SUGGEST_FOCUSED_CONTEXT_KEY);
    this.composingKey = contextKey(editor, COMPOSING_CONTEXT_KEY);
    this.subscriptions.push(
      editor.onDidCompositionStart((): void => this.setComposing(true)),
      editor.onDidCompositionEnd((): void => this.setComposing(false)),
      editor.onDidScrollChange((): void => this.render()),
      editor.onDidLayoutChange((): void => this.render()),
    );
    const typing: AriaEditor['onWillType'] = (editor as AriaEditor).onWillType;
    if (typeof typing === 'function') {
      this.subscriptions.push(typing.call(editor, (text: string): void => this.onWillType(text)));
    }
  }

  /**
   * Starts a session: one the user asked for says it is loading after a delay, unless an answer comes
   * first.
   * @param control The session.
   * @param auto Whether the session started on its own.
   * @param delay How long to wait before saying it is loading, in milliseconds.
   */
  public triggered(control: SuggestControl, auto: boolean, delay: number): void {
    this.control = control;
    if (this.visible || auto) {
      return;
    }
    this.clearLoading();
    this.pendingLoading = this.host.delay((): void => {
      this.pendingLoading = null;
      if (!this.visible) {
        this.message = LOADING_MESSAGE;
        this.show();
      }
    }, delay);
  }

  /**
   * Shows an answer: the rows, with Monaco's chosen item focused. An empty answer closes a session
   * that started on its own, and says there is nothing for one the user asked for. A frozen answer
   * keeps what shows.
   * @param control The session.
   * @param list The answer.
   */
  public suggestions(control: SuggestControl, list: SuggestList): void {
    this.control = control;
    this.clearLoading();
    if (list.frozen && this.visible && this.items.length > 0) {
      this.frozen = true;
      return;
    }
    this.frozen = list.frozen;
    if (list.items.length === 0) {
      if (list.auto) {
        this.hidden();
        return;
      }
      this.setItems([], EMPTY_MESSAGE);
      this.focused = -1;
      this.show();
      return;
    }
    const items: readonly SuggestItem[] = servedOnly(list.items);
    this.setItems(items, null);
    const selected: number = list.selected === undefined ? 0 : items.indexOf(list.selected);
    this.focused = list.noFocus ? -1 : Math.max(0, selected);
    this.show();
    this.focusChanged();
  }

  /**
   * Ends the session: the list goes.
   */
  public hidden(): void {
    this.clearLoading();
    this.cancelResolve();
    this.pendingFrame?.();
    this.pendingFrame = null;
    this.surface?.dispose();
    this.surface = null;
    this.visible = false;
    this.frozen = false;
    this.control = null;
    this.setItems([], null);
    this.focused = -1;
    this.visibleKey.set(false);
    this.focusedKey.set(false);
    this.setActiveDescendant(undefined);
  }

  /**
   * Gets whether the list shows.
   * @returns Returns true when it does.
   */
  public get showing(): boolean {
    return this.visible;
  }

  /**
   * Gets the focused item.
   * @returns Returns the item, or undefined when none is focused or the list does not show.
   */
  public focusedItem(): SuggestItem | undefined {
    return this.visible ? this.items[this.focused] : undefined;
  }

  /**
   * Moves the focus: down or up one row (round the ends), down or up a page, or to either end.
   * @param move Where to.
   */
  public move(move: SuggestMove): void {
    const count: number = this.items.length;
    if (!this.visible || count === 0) {
      return;
    }
    const at: number = this.focused;
    const page: number = VISIBLE_ROWS - 1;
    switch (move) {
      case 'next':
        this.focused = at < 0 ? 0 : (at + 1) % count;
        break;
      case 'previous':
        this.focused = at < 0 ? count - 1 : (at - 1 + count) % count;
        break;
      case 'nextPage':
        this.focused = Math.min(count - 1, Math.max(at, 0) + page);
        break;
      case 'previousPage':
        this.focused = Math.max(0, at - page);
        break;
      case 'first':
        this.focused = 0;
        break;
      case 'last':
        this.focused = count - 1;
        break;
    }
    this.focusChanged();
  }

  /**
   * Accepts the focused item through Monaco's insertion — never while an input method composes.
   * @returns Returns true when an item was accepted.
   */
  public accept(): boolean {
    const item: SuggestItem | undefined = this.focusedItem();
    if (this.composing || item === undefined || this.control === null) {
      return false;
    }
    this.control.insert(item, 'select');
    return true;
  }

  /**
   * Focuses and accepts a row that was clicked.
   * @param index The row's index.
   */
  public choose(index: number): void {
    if (index < 0 || index >= this.items.length) {
      return;
    }
    if (index !== this.focused) {
      this.focused = index;
      this.focusChanged();
    }
    this.accept();
  }

  /**
   * Takes the list away and releases the editor's subscriptions.
   */
  public dispose(): void {
    this.hidden();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  /**
   * Shows the list, setting its context keys at once and drawing at the next frame.
   */
  private show(): void {
    this.visible = true;
    this.visibleKey.set(true);
    this.focusedKey.set(this.focusedItem() !== undefined);
    this.render();
  }

  /**
   * Follows a move of the focus: its context key, Monaco's focus event, and the provider's details of
   * the item newly focused.
   */
  private focusChanged(): void {
    const item: SuggestItem | undefined = this.focusedItem();
    this.focusedKey.set(item !== undefined);
    this.cancelResolve();
    if (item !== undefined) {
      this.control?.focused(item);
      if (canResolve(item)) {
        this.resolve(item);
      }
    }
    this.render();
  }

  /**
   * Asks the provider to fill an item in, and redraws once it has — unless the focus has moved on, in
   * which case the request is cancelled and its answer dropped.
   * @param item The item.
   */
  private resolve(item: SuggestItem): void {
    const request: Cancellation = this.host.cancellation();
    this.resolving = request;
    item
      .resolve(request.token)
      .then((): void => {
        if (this.resolving === request && this.focusedItem() === item) {
          this.render();
        }
      })
      .catch((): void => undefined)
      .finally((): void => {
        if (this.resolving === request) {
          this.resolving = null;
        }
        request.dispose();
      });
  }

  /**
   * Cancels the provider's request for the item focused before.
   */
  private cancelResolve(): void {
    this.resolving?.cancel();
    this.resolving = null;
  }

  /**
   * Asks for a draw at the next frame, once however many changes come before it.
   */
  private render(): void {
    if (!this.visible || this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = this.host.frame((): void => {
      this.pendingFrame = null;
      this.draw();
    });
  }

  /**
   * Draws the list: puts it on screen the first time the word can be seen, shows its view and places
   * it under the word (or hides it while the word is out of sight).
   */
  private draw(): void {
    if (!this.visible) {
      return;
    }
    const origin: EditorOrigin | null = this.origin();
    if (this.surface === null) {
      if (origin === null) {
        return;
      }
      this.surface = this.host.present(origin, (index: number): void => this.choose(index));
    }
    this.surface.update(this.view(origin));
    this.surface.place(origin);
    this.setActiveDescendant(
      this.focusedItem() === undefined ? undefined : `${this.idPrefix}-${this.focused}`,
    );
  }

  /**
   * Builds the list's view.
   * @param origin Where the list is placed, which decides whether the details pane fits beside it.
   * @returns Returns the view.
   */
  private view(origin: EditorOrigin | null): CompletionListView {
    const items: readonly SuggestItem[] = this.items;
    const rows: Map<number, CompletionRow> = this.rows;
    const item: SuggestItem | undefined = this.focusedItem();
    const details: CompletionDetails | null =
      item === undefined ? null : detailsOf(item, this.editor.getModel()?.getLanguageId() ?? '');
    return {
      count: items.length,
      row: (index: number): CompletionRow => {
        let row: CompletionRow | undefined = rows.get(index);
        if (row === undefined) {
          row = rowOf(items[index]);
          rows.set(index, row);
        }
        return row;
      },
      focused: item === undefined ? -1 : this.focused,
      message: items.length === 0 ? this.message : null,
      details,
      placement: this.placement(origin),
      idPrefix: this.idPrefix,
    };
  }

  /**
   * Decides where the details pane goes: beside the list when there is room right of the word, under
   * it otherwise.
   * @param origin Where the list is placed.
   * @returns Returns the placement.
   */
  private placement(origin: EditorOrigin | null): CompletionPlacement {
    const width: number =
      this.editor.getContainerDomNode().ownerDocument.defaultView?.innerWidth ?? 0;
    return origin === null || width - origin.x >= SIDE_BY_SIDE_PX ? 'side' : 'below';
  }

  /**
   * Measures the line the list is placed against: the caret's line, from the start of the word being
   * typed (less the rows' icon, so the labels line up under the word), in client pixels.
   * @returns Returns the box, or null when the caret's line cannot be seen.
   */
  private origin(): EditorOrigin | null {
    const position: MonacoApi.Position | null = this.editor.getPosition();
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (position === null || model === null) {
      return null;
    }
    const column: number = model.getWordUntilPosition(position).startColumn;
    const at: { top: number; left: number; height: number } | null =
      this.editor.getScrolledVisiblePosition({ lineNumber: position.lineNumber, column });
    const box: DOMRect = this.editor.getContainerDomNode().getBoundingClientRect();
    if (at === null || at.top + at.height <= 0 || at.top >= box.height) {
      return null;
    }
    return {
      x: box.left + Math.max(0, at.left - LABEL_INSET_PX),
      y: box.top + at.top,
      width: 0,
      height: at.height,
    };
  }

  /**
   * Accepts the focused item when a character it commits on is typed (a `.` after a member, say), as
   * Monaco does — unless the editor says not to, an input method composes, or the answer is frozen.
   * @param text The text about to be typed.
   */
  private onWillType(text: string): void {
    const item: SuggestItem | undefined = this.focusedItem();
    const characters: readonly string[] | undefined = item?.completion.commitCharacters;
    if (
      item === undefined ||
      characters === undefined ||
      characters.length === 0 ||
      this.frozen ||
      this.composing ||
      this.control?.active !== true ||
      this.editor.getOption(ACCEPT_ON_COMMIT_CHARACTER) === false
    ) {
      return;
    }
    const typed: string = text.charAt(text.length - 1);
    if (
      typed.length > 0 &&
      characters.some((character: string): boolean => character.startsWith(typed))
    ) {
      this.control.insert(item, 'commit');
    }
  }

  /**
   * Follows the input method: none of the list's keys act while it composes.
   * @param composing Whether it composes.
   */
  private setComposing(composing: boolean): void {
    this.composing = composing;
    this.composingKey.set(composing);
  }

  /**
   * Replaces the items listed, and the rows built for them.
   * @param items The items.
   * @param message What the list says when there are none.
   */
  private setItems(items: readonly SuggestItem[], message: string | null): void {
    this.items = items;
    this.rows = new Map<number, CompletionRow>();
    this.message = message;
  }

  /**
   * Cancels the pending "Loading…".
   */
  private clearLoading(): void {
    this.pendingLoading?.();
    this.pendingLoading = null;
  }

  /**
   * Names the focused row as the editor text area's active descendant, so a screen reader reads it.
   * @param id The row's element identifier, or undefined for none.
   */
  private setActiveDescendant(id: string | undefined): void {
    (this.editor as AriaEditor).setAriaOptions?.({ activeDescendant: id });
  }
}

/**
 * Makes one of an editor's context keys, false at first. Every editor of the standalone build — a
 * diff's sides too — can make them, though only the standalone editor's type says so.
 * @param editor The editor.
 * @param key The key's name.
 * @returns Returns the key.
 */
function contextKey(
  editor: MonacoApi.editor.ICodeEditor,
  key: string,
): MonacoApi.editor.IContextKey<boolean> {
  return (editor as MonacoApi.editor.IStandaloneCodeEditor).createContextKey<boolean>(key, false);
}

/**
 * Keeps a language server's completions alone when it gave any. Monaco's own worker answers for the
 * same language with the same names, so listing both showed every symbol twice (#1021, as hovers did
 * in #1020); the worker's — and Monaco's word list — are kept only where no server spoke.
 * @param items The items Monaco ranked, best first.
 * @returns Returns the items to list, in the same order.
 */
export function servedOnly(items: readonly SuggestItem[]): readonly SuggestItem[] {
  const served: readonly SuggestItem[] = items.filter((item: SuggestItem): boolean =>
    isStudioProvider(item.provider),
  );
  return served.length > 0 ? served : items;
}
