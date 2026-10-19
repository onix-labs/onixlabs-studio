import type * as MonacoApi from 'monaco-editor';
import { focusedEditor } from './monaco-find-commands';

/**
 * Names Monaco's Trigger Suggest action (#1021): ⌃Space on macOS (with ⌥Esc and ⌘I), Ctrl+Space and
 * Ctrl+I elsewhere. Its chords are removed, on every platform; Studio's Trigger Suggest takes them.
 */
export const MONACO_TRIGGER_SUGGEST_COMMAND: string = 'editor.action.triggerSuggest';

/**
 * Names Monaco's Trigger Parameter Hints action (#1021): ⌘⇧Space (Ctrl+Shift+Space). Its chord is
 * removed; Studio's takes it.
 */
export const MONACO_TRIGGER_PARAMETER_HINTS_COMMAND: string = 'editor.action.triggerParameterHints';

/**
 * Names Studio's Trigger Suggest command, which opens the completion list at the caret.
 */
export const STUDIO_TRIGGER_SUGGEST_COMMAND: string = 'studio.triggerSuggest';

/**
 * Names Studio's command that moves the completion list's focus down one row (↓).
 */
export const STUDIO_SUGGEST_NEXT_COMMAND: string = 'studio.suggest.next';

/**
 * Names Studio's command that moves the completion list's focus up one row (↑).
 */
export const STUDIO_SUGGEST_PREVIOUS_COMMAND: string = 'studio.suggest.previous';

/**
 * Names Studio's command that moves the completion list's focus down a page (PgDn).
 */
export const STUDIO_SUGGEST_NEXT_PAGE_COMMAND: string = 'studio.suggest.nextPage';

/**
 * Names Studio's command that moves the completion list's focus up a page (PgUp).
 */
export const STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND: string = 'studio.suggest.previousPage';

/**
 * Names Studio's command that accepts the completion list's focused row (Enter, Tab).
 */
export const STUDIO_SUGGEST_ACCEPT_COMMAND: string = 'studio.suggest.accept';

/**
 * Names Studio's command that closes the completion list (Escape).
 */
export const STUDIO_SUGGEST_HIDE_COMMAND: string = 'studio.suggest.hide';

/**
 * Names Studio's Trigger Parameter Hints command, which shows the signature card at the caret.
 */
export const STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND: string = 'studio.triggerParameterHints';

/**
 * Names Studio's command that shows the next overload on the signature card (↓).
 */
export const STUDIO_PARAMETER_HINTS_NEXT_COMMAND: string = 'studio.parameterHints.next';

/**
 * Names Studio's command that shows the previous overload on the signature card (↑).
 */
export const STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND: string = 'studio.parameterHints.previous';

/**
 * Names Studio's command that closes the signature card (Escape).
 */
export const STUDIO_PARAMETER_HINTS_HIDE_COMMAND: string = 'studio.parameterHints.hide';

/**
 * Names the editor context key that is true while an editor's completion list shows: the list's keys
 * (↑ ↓ PgUp PgDn Enter Tab Escape) reach it only then, and the editor keeps them otherwise.
 */
export const SUGGEST_VISIBLE_CONTEXT_KEY: string = 'studioSuggestVisible';

/**
 * Names the editor context key that is true while a row of the completion list is focused, which is
 * when Enter and Tab accept rather than reach the editor.
 */
export const SUGGEST_FOCUSED_CONTEXT_KEY: string = 'studioSuggestFocused';

/**
 * Names the editor context key that is true while an input method is composing in the editor: none of
 * the list's or the card's keys act then, so Enter, Tab, the arrows and Escape reach the input method.
 */
export const COMPOSING_CONTEXT_KEY: string = 'studioEditorComposing';

/**
 * Names the editor context key that is true while an editor's signature card shows.
 */
export const PARAMETER_HINTS_VISIBLE_CONTEXT_KEY: string = 'studioParameterHintsVisible';

/**
 * Names the editor context key that is true while the signature card has more than one overload to
 * step through.
 */
export const PARAMETER_HINTS_MULTIPLE_CONTEXT_KEY: string = 'studioParameterHintsMultiple';

/**
 * Names the editor contribution behind Monaco's autocomplete: it owns the suggest model (triggering,
 * filtering, ranking) — which Studio keeps — and builds Monaco's suggest widget, at window idle, in
 * every editor — which Studio stops.
 */
export const SUGGEST_CONTRIBUTION: string = 'editor.contrib.suggestController';

/**
 * Names the editor contribution behind Monaco's parameter hints: it owns the signature-help model —
 * which Studio keeps — and builds Monaco's parameter-hints widget the first time hints arrive — which
 * Studio stops.
 */
export const PARAMETER_HINTS_CONTRIBUTION: string = 'editor.controller.parameterHints';

/**
 * Lists the members of Monaco's suggest contribution the takeover relies on (#1021). The contract spec
 * reads Monaco's bundle for each, so an upgrade that renames one fails the build rather than bringing
 * Monaco's widget back or leaving the list dead.
 */
export const SUGGEST_HOOKS: readonly string[] = [
  // Assigned in the constructor: the idle value that builds Monaco's widget, replaced per editor.
  'widget',
  // Called on the widget the takeover puts in its place.
  'showTriggered',
  'showSuggestions',
  'hideWidget',
  'getFocusedItem',
  // Called on the contribution by Studio's commands.
  '_insertSuggestion',
  'cancelSuggestWidget',
  'triggerSuggest',
];

/**
 * Lists the members of Monaco's parameter-hints contribution the takeover relies on.
 */
export const PARAMETER_HINTS_HOOKS: readonly string[] = [
  // Assigned in the constructor: the lazy value that builds Monaco's widget, replaced per editor.
  'widget',
  // Called on the widget the takeover puts in its place.
  'show',
  'render',
  'rawValue',
  // Called on the contribution by Studio's commands.
  'cancel',
  'trigger',
  'next',
  'previous',
];

/**
 * Names the debug name of Monaco's word-based completion provider, whose words are left out of the
 * list for a document a language server serves.
 */
export const WORD_BASED_PROVIDER_NAME: string = 'wordbasedCompletions';

/**
 * Holds Monaco's `SignatureHelpTriggerKind.Invoke`.
 */
const SIGNATURE_HELP_INVOKE: number = 1;

/**
 * Holds Monaco's `InsertFlags.None`: the flags Monaco's widget accepts with.
 */
const INSERT_NONE: number = 0;

/**
 * Holds Monaco's `InsertFlags.NoAfterUndoStop`: the flags a commit character accepts with, so the
 * character typed joins the completion's undo step.
 */
const INSERT_NO_AFTER_UNDO_STOP: number = 2;

/**
 * Holds Monaco's `suggest` model state `Idle`.
 */
const SUGGEST_IDLE: number = 0;

/**
 * Monaco's `KeyMod.WinCtrl`: the Control key on macOS, where `CtrlCmd` is ⌘.
 */
const WIN_CTRL: number = 256;

/**
 * One completion Monaco's suggest model holds — its private `CompletionItem` — with only what Studio
 * reads.
 */
export interface SuggestItem {
  /**
   * Gets the provider's completion, which resolving fills in.
   */
  readonly completion: MonacoApi.languages.CompletionItem;

  /**
   * Gets the label as text.
   */
  readonly textLabel: string;

  /**
   * Gets the fuzzy score against the typed word: its rank, the word's start, then the label's matched
   * character positions.
   */
  readonly score: readonly number[];

  /**
   * Gets the provider that offered it.
   */
  readonly provider: SuggestProvider;

  /**
   * Gets whether its provider has filled it in (or cannot).
   */
  readonly isResolved: boolean;

  /**
   * Asks its provider to fill it in — its documentation, detail and extra edits — once.
   * @param token Cancels the request.
   * @returns Returns a promise that settles once it is filled in, or the request ends.
   */
  resolve(token: MonacoApi.CancellationToken): Promise<void>;
}

/**
 * The provider of a {@link SuggestItem}, with only what Studio reads.
 */
export interface SuggestProvider {
  /**
   * Gets the provider's resolver, when it fills its items in.
   */
  readonly resolveCompletionItem?: unknown;

  /**
   * Gets Monaco's debug name for the provider, which tells its word-based provider apart.
   */
  readonly _debugDisplayName?: string;
}

/**
 * Monaco's completion model — the filtered, ranked items of one suggest session — with only what
 * Studio reads.
 */
export interface SuggestCompletionModel {
  /**
   * Gets the items that match what has been typed, best first.
   */
  readonly items: readonly SuggestItem[];
}

/**
 * One answer of Monaco's suggest model, as Studio's list shows it.
 */
export interface SuggestList {
  /**
   * Gets the items to list, best first: Monaco's, less any word-based ones the document should not
   * show.
   */
  readonly items: readonly SuggestItem[];

  /**
   * Gets the item Monaco's suggest memory chose to focus.
   */
  readonly selected: SuggestItem | undefined;

  /**
   * Gets whether the answer is frozen: the session awaits a provider's next answer, and the list keeps
   * what it shows.
   */
  readonly frozen: boolean;

  /**
   * Gets whether the session started on its own (typing), rather than by the user asking.
   */
  readonly auto: boolean;

  /**
   * Gets whether no row should be focused at first.
   */
  readonly noFocus: boolean;
}

/**
 * How a completion was accepted, which decides its undo stops.
 */
export type SuggestAcceptance = 'select' | 'commit';

/**
 * Names a move of the completion list's focus.
 */
export type SuggestMove = 'next' | 'previous' | 'nextPage' | 'previousPage' | 'first' | 'last';

/**
 * What Studio's list can do to Monaco's suggest session of an editor.
 */
export interface SuggestControl {
  /**
   * Gets whether the session is still running.
   */
  readonly active: boolean;

  /**
   * Inserts an item through Monaco's own insertion — its snippet with tab stops, its extra edits
   * (auto-imports), the text it overwrites, the suggest memory and its command — as one undo step.
   * @param item The item.
   * @param how How it was accepted.
   */
  insert(item: SuggestItem, how: SuggestAcceptance): void;

  /**
   * Ends the session, closing the list.
   */
  cancel(): void;

  /**
   * Tells Monaco the list's focus moved (what inline completions follow).
   * @param item The focused item.
   */
  focused(item: SuggestItem): void;
}

/**
 * What draws Studio's completion list in place of Monaco's suggest widget.
 */
export interface SuggestPresenter {
  /**
   * Receives the start of a suggest session in an editor: the list may say it is loading after a
   * delay, for a session the user asked for.
   * @param editor The editor.
   * @param control The session.
   * @param auto Whether the session started on its own.
   * @param delay How long to wait before saying it is loading, in milliseconds.
   */
  triggered(
    editor: MonacoApi.editor.ICodeEditor,
    control: SuggestControl,
    auto: boolean,
    delay: number,
  ): void;

  /**
   * Receives an answer of a suggest session: the first, or a refiltering as the user types.
   * @param editor The editor.
   * @param control The session.
   * @param list The answer.
   */
  suggestions(
    editor: MonacoApi.editor.ICodeEditor,
    control: SuggestControl,
    list: SuggestList,
  ): void;

  /**
   * Receives the end of a suggest session: the list goes.
   * @param editor The editor.
   */
  hidden(editor: MonacoApi.editor.ICodeEditor): void;

  /**
   * Answers which item the list focuses, which Monaco's own accept and inline completions read.
   * @param editor The editor.
   * @returns Returns the item, or undefined when none is focused.
   */
  focusedItem(editor: MonacoApi.editor.ICodeEditor): SuggestItem | undefined;

  /**
   * Moves the list's focus.
   * @param editor The editor.
   * @param move Where to.
   */
  move(editor: MonacoApi.editor.ICodeEditor, move: SuggestMove): void;

  /**
   * Accepts the list's focused item.
   * @param editor The editor.
   */
  accept(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Determines whether Monaco's word-based suggestions are left out for a document: a language server
 * serves it, and its words would only stand in for the server's silence.
 */
export type WordSuggestionsSuppressed = (model: MonacoApi.editor.ITextModel) => boolean;

/**
 * What Studio's signature card can do to Monaco's parameter-hints session of an editor.
 */
export interface ParameterHintsControl {
  /**
   * Shows the next overload.
   */
  next(): void;

  /**
   * Shows the previous overload.
   */
  previous(): void;

  /**
   * Ends the session, closing the card.
   */
  cancel(): void;
}

/**
 * What draws Studio's signature card in place of Monaco's parameter-hints widget.
 */
export interface ParameterHintsPresenter {
  /**
   * Shows (or updates) an editor's signature card.
   * @param editor The editor.
   * @param control The session.
   * @param hints The signatures, with the active one and its active parameter.
   */
  showSignatures(
    editor: MonacoApi.editor.ICodeEditor,
    control: ParameterHintsControl,
    hints: MonacoApi.languages.SignatureHelp,
  ): void;

  /**
   * Takes an editor's signature card away.
   * @param editor The editor.
   */
  hideSignatures(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Draws nothing of a suggest session: what the takeover hands sessions to before Studio's presenter
 * is ready, so Monaco's widget still never shows.
 */
export const IDLE_SUGGEST_PRESENTER: SuggestPresenter = {
  triggered: (): void => undefined,
  suggestions: (): void => undefined,
  hidden: (): void => undefined,
  focusedItem: (): undefined => undefined,
  move: (): void => undefined,
  accept: (): void => undefined,
};

/**
 * Draws nothing of a parameter-hints session, before Studio's presenter is ready.
 */
export const IDLE_PARAMETER_HINTS_PRESENTER: ParameterHintsPresenter = {
  showSignatures: (): void => undefined,
  hideSignatures: (): void => undefined,
};

/**
 * Monaco's suggest contribution, with only what the takeover reads and replaces.
 */
interface SuggestContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets or sets the idle value that builds Monaco's widget — or the takeover's stand-in.
   */
  widget?: unknown;

  /**
   * Gets the suggest model.
   */
  readonly model?: { readonly state: number };

  /**
   * Inserts an item, Monaco's way.
   */
  _insertSuggestion?: (
    event: { readonly index: number; readonly item: SuggestItem; readonly model: unknown },
    flags: number,
  ) => void;

  /**
   * Ends the session and hides the widget.
   */
  cancelSuggestWidget?: () => void;

  /**
   * Starts a session at the caret.
   */
  triggerSuggest?: () => void;
}

/**
 * Monaco's parameter-hints contribution, with only what the takeover reads and replaces.
 */
interface ParameterHintsContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets or sets the lazy value that builds Monaco's widget — or the takeover's stand-in.
   */
  widget?: unknown;

  /**
   * Gets the signature-help model.
   */
  readonly model?: { next(): void; previous(): void };

  /**
   * Ends the session.
   */
  cancel?: () => void;

  /**
   * Starts a session at the caret.
   */
  trigger?: (context: { readonly triggerKind: number }) => void;

  /**
   * Shows the next overload.
   */
  next?: () => void;

  /**
   * Shows the previous overload.
   */
  previous?: () => void;
}

/**
 * Monaco's idle value, with only what the takeover calls on the one it replaces.
 */
interface DeferredValue {
  /**
   * Cancels the idle build.
   */
  dispose?: () => void;
}

/**
 * A listener of one of the stand-in widget's events.
 */
type Listener<T> = (value: T) => void;

/**
 * An event in Monaco's shape: subscribing returns what unsubscribes.
 */
type MonacoEvent<T> = (listener: Listener<T>) => MonacoApi.IDisposable;

/**
 * A minimal emitter in Monaco's shape, for the events Monaco's code subscribes to on the widget.
 */
class Emitter<T> {
  /**
   * Holds the listeners.
   */
  private readonly listeners: Set<Listener<T>> = new Set<Listener<T>>();

  /**
   * Gets the event to subscribe to.
   */
  public readonly event: MonacoEvent<T> = (listener: Listener<T>): MonacoApi.IDisposable => {
    this.listeners.add(listener);
    return { dispose: (): void => void this.listeners.delete(listener) };
  };

  /**
   * Tells every listener.
   * @param value What to tell them.
   */
  public fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  /**
   * Drops every listener.
   */
  public dispose(): void {
    this.listeners.clear();
  }
}

/**
 * Stands in for Monaco's suggest widget in one editor (#1021): it builds no DOM, and hands what
 * Monaco's suggest contribution would show to Studio's presenter. Monaco's code reads the same
 * surface off it as off its own widget — the inline-completions adapter subscribes to its events.
 */
export class StudioSuggestWidget {
  /**
   * Holds the completion model of the answer shown, which an accept indexes into.
   */
  private model: SuggestCompletionModel | null = null;

  /**
   * Holds whether the shown answer is frozen.
   */
  private frozen: boolean = false;

  /**
   * Raised when the list shows.
   */
  private readonly shown: Emitter<StudioSuggestWidget> = new Emitter<StudioSuggestWidget>();

  /**
   * Raised when the list goes.
   */
  private readonly gone: Emitter<StudioSuggestWidget> = new Emitter<StudioSuggestWidget>();

  /**
   * Raised when the list's focus moves.
   */
  private readonly focusMoved: Emitter<{ readonly item: SuggestItem }> = new Emitter<{
    readonly item: SuggestItem;
  }>();

  /**
   * Raised when an item is chosen (never: Studio inserts through the contribution itself).
   */
  private readonly selected: Emitter<unknown> = new Emitter<unknown>();

  /**
   * Gets the event raised when the list shows.
   */
  public readonly onDidShow: MonacoEvent<StudioSuggestWidget> = this.shown.event;

  /**
   * Gets the event raised when the list goes.
   */
  public readonly onDidHide: MonacoEvent<StudioSuggestWidget> = this.gone.event;

  /**
   * Gets the event raised when the list's focus moves.
   */
  public readonly onDidFocus: MonacoEvent<{ readonly item: SuggestItem }> = this.focusMoved.event;

  /**
   * Gets the event raised when an item is chosen.
   */
  public readonly onDidSelect: MonacoEvent<unknown> = this.selected.event;

  /**
   * Holds what Studio's list can do to the session.
   */
  private readonly control: SuggestControl;

  /**
   * Initializes a new instance of the {@link StudioSuggestWidget} class.
   * @param editor The editor.
   * @param contribution Monaco's suggest contribution of the editor.
   * @param presenter Resolves the presenter as it is needed.
   * @param suppressed Determines whether a document's word-based suggestions are left out.
   */
  public constructor(
    private readonly editor: MonacoApi.editor.ICodeEditor,
    private readonly contribution: SuggestContribution,
    private readonly presenter: () => SuggestPresenter,
    private readonly suppressed: WordSuggestionsSuppressed,
  ) {
    this.control = {
      get active(): boolean {
        return (contribution.model?.state ?? SUGGEST_IDLE) !== SUGGEST_IDLE;
      },
      insert: (item: SuggestItem, how: SuggestAcceptance): void => this.insert(item, how),
      cancel: (): void => contribution.cancelSuggestWidget?.(),
      focused: (item: SuggestItem): void => this.focusMoved.fire({ item }),
    };
  }

  /**
   * Starts showing a session: Monaco's widget would say it is loading after the delay.
   * @param auto Whether the session started on its own.
   * @param delay How long to wait before saying it is loading, in milliseconds.
   */
  public showTriggered(auto: boolean, delay: number): void {
    this.presenter().triggered(this.editor, this.control, auto, delay);
  }

  /**
   * Shows an answer of the session.
   * @param model The completion model.
   * @param selectionIndex The index of the item to focus, in the model.
   * @param isFrozen Whether the answer is frozen.
   * @param isAuto Whether the session started on its own.
   * @param noFocus Whether no row is focused at first.
   */
  public showSuggestions(
    model: SuggestCompletionModel,
    selectionIndex: number,
    isFrozen: boolean,
    isAuto: boolean,
    noFocus: boolean,
  ): void {
    this.model = model;
    this.frozen = isFrozen;
    const presenter: SuggestPresenter = this.presenter();
    const document: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    const items: readonly SuggestItem[] =
      document !== null && this.suppressed(document)
        ? model.items.filter(
            (item: SuggestItem): boolean =>
              item.provider._debugDisplayName !== WORD_BASED_PROVIDER_NAME,
          )
        : model.items;
    const selected: SuggestItem | undefined = model.items[selectionIndex];
    presenter.suggestions(this.editor, this.control, {
      items,
      selected: selected !== undefined && items.includes(selected) ? selected : items[0],
      frozen: isFrozen,
      auto: isAuto,
      noFocus,
    });
    this.shown.fire(this);
  }

  /**
   * Ends showing the session.
   */
  public hideWidget(): void {
    this.model = null;
    this.frozen = false;
    this.presenter().hidden(this.editor);
    this.gone.fire(this);
  }

  /**
   * Gets the focused item, as Monaco's own accept and inline completions read it.
   * @returns Returns the item, its index and the model, or undefined when none is focused.
   */
  public getFocusedItem():
    | { readonly item: SuggestItem; readonly index: number; readonly model: SuggestCompletionModel }
    | undefined {
    const item: SuggestItem | undefined = this.presenter().focusedItem(this.editor);
    const index: number =
      item === undefined || this.model === null ? -1 : this.model.items.indexOf(item);
    return item === undefined || this.model === null || index < 0
      ? undefined
      : { item, index, model: this.model };
  }

  /**
   * Gets whether the shown answer is frozen.
   * @returns Returns true when it is.
   */
  public isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Moves the focus down one row.
   */
  public selectNext(): void {
    this.presenter().move(this.editor, 'next');
  }

  /**
   * Moves the focus up one row.
   */
  public selectPrevious(): void {
    this.presenter().move(this.editor, 'previous');
  }

  /**
   * Moves the focus down a page.
   */
  public selectNextPage(): void {
    this.presenter().move(this.editor, 'nextPage');
  }

  /**
   * Moves the focus up a page.
   */
  public selectPreviousPage(): void {
    this.presenter().move(this.editor, 'previousPage');
  }

  /**
   * Moves the focus to the first row.
   */
  public selectFirst(): void {
    this.presenter().move(this.editor, 'first');
  }

  /**
   * Moves the focus to the last row.
   */
  public selectLast(): void {
    this.presenter().move(this.editor, 'last');
  }

  /**
   * Does nothing: Studio's list keeps a row focused while it shows.
   */
  public focusSelected(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's details pane shows whenever the focused row has details.
   */
  public toggleDetails(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's list has no explain mode.
   */
  public toggleExplainMode(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's details pane never takes the keyboard.
   */
  public toggleDetailsFocus(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's list is not resized by hand.
   */
  public resetPersistedSize(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's list places itself.
   */
  public forceRenderingAbove(): void {
    // Nothing to do.
  }

  /**
   * Does nothing: Studio's list places itself.
   */
  public stopForceRenderingAbove(): void {
    // Nothing to do.
  }

  /**
   * Takes the list away and drops the listeners.
   */
  public dispose(): void {
    this.presenter().hidden(this.editor);
    this.shown.dispose();
    this.gone.dispose();
    this.focusMoved.dispose();
    this.selected.dispose();
  }

  /**
   * Inserts an item through Monaco's own insertion.
   * @param item The item.
   * @param how How it was accepted.
   */
  private insert(item: SuggestItem, how: SuggestAcceptance): void {
    const model: SuggestCompletionModel | null = this.model;
    const index: number = model === null ? -1 : model.items.indexOf(item);
    if (model === null || index < 0) {
      return;
    }
    this.contribution._insertSuggestion?.(
      { index, item, model },
      how === 'commit' ? INSERT_NO_AFTER_UNDO_STOP : INSERT_NONE,
    );
  }
}

/**
 * Stands in for Monaco's parameter-hints widget in one editor (#1021): it builds no DOM, and hands the
 * signatures Monaco's parameter-hints contribution would show to Studio's presenter.
 */
export class StudioParameterHintsWidget {
  /**
   * Holds what Studio's card can do to the session.
   */
  private readonly control: ParameterHintsControl;

  /**
   * Initializes a new instance of the {@link StudioParameterHintsWidget} class.
   * @param editor The editor.
   * @param contribution Monaco's parameter-hints contribution of the editor.
   * @param presenter Resolves the presenter as it is needed.
   */
  public constructor(
    private readonly editor: MonacoApi.editor.ICodeEditor,
    contribution: ParameterHintsContribution,
    private readonly presenter: () => ParameterHintsPresenter,
  ) {
    this.control = {
      next: (): void => contribution.model?.next(),
      previous: (): void => contribution.model?.previous(),
      cancel: (): void => contribution.cancel?.(),
    };
  }

  /**
   * Gets the stand-in itself, as Monaco's lazy value's built value.
   * @returns Returns the stand-in.
   */
  public get value(): StudioParameterHintsWidget {
    return this;
  }

  /**
   * Gets the stand-in itself, as Monaco's lazy value's value when built.
   * @returns Returns the stand-in.
   */
  public get rawValue(): StudioParameterHintsWidget {
    return this;
  }

  /**
   * Does nothing: {@link render} shows the card.
   */
  public show(): void {
    // Nothing to do.
  }

  /**
   * Shows the signatures on Studio's card.
   * @param hints The signatures.
   */
  public render(hints: MonacoApi.languages.SignatureHelp): void {
    this.presenter().showSignatures(this.editor, this.control, hints);
  }

  /**
   * Takes Studio's card away.
   */
  public hide(): void {
    this.presenter().hideSignatures(this.editor);
  }

  /**
   * Shows the next overload.
   */
  public next(): void {
    this.control.next();
  }

  /**
   * Shows the previous overload.
   */
  public previous(): void {
    this.control.previous();
  }

  /**
   * Takes Studio's card away.
   */
  public dispose(): void {
    this.hide();
  }
}

/**
 * Removes Monaco's Trigger Suggest and Trigger Parameter Hints chords from a Monaco instance and binds
 * Studio's in their place (#1021): Trigger Suggest on ⌃Space, ⌥Esc and ⌘I on macOS and Ctrl+Space and
 * Ctrl+I elsewhere; Trigger Parameter Hints on ⌘⇧Space (Ctrl+Shift+Space). Binds the completion list's
 * keys — ↑ ↓ PgUp PgDn to move, Enter and Tab to accept, Escape to close — and the signature card's —
 * ↑ ↓ for its overloads, Escape to close — each only while its context key says the list (or card)
 * shows, and never while an input method composes. Studio's rules outweigh every built-in one, so they
 * win over the snippet's Tab and Escape while the list shows. Then, in each editor the instance
 * creates, puts stand-ins in place of Monaco's suggest and parameter-hints widgets before either is
 * built, so neither widget's DOM is ever on the page: Monaco's models keep triggering, filtering and
 * ranking, and Studio draws what they find.
 *
 * Each instance (the main window's, and each child window's) has its own keybinding service, so each is
 * prepared once, as it loads.
 * @param monaco The Monaco instance.
 * @param isMac Whether the host is macOS, which decides the Trigger Suggest chords.
 * @param suggest Resolves the completion list's presenter as it is needed.
 * @param hints Resolves the signature card's presenter as it is needed.
 * @param suppressed Determines whether a document's word-based suggestions are left out of the list.
 */
export function installSuggestCommands(
  monaco: typeof MonacoApi,
  isMac: boolean,
  suggest: () => SuggestPresenter,
  hints: () => ParameterHintsPresenter,
  suppressed: WordSuggestionsSuppressed = (): boolean => false,
): void {
  const focused: (run: (editor: MonacoApi.editor.ICodeEditor) => void) => () => void =
    (run: (editor: MonacoApi.editor.ICodeEditor) => void): (() => void) =>
    (): void => {
      const editor: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
      if (editor !== undefined) {
        run(editor);
      }
    };
  const moveTo: (move: SuggestMove) => () => void = (move: SuggestMove): (() => void) =>
    focused((editor: MonacoApi.editor.ICodeEditor): void => suggest().move(editor, move));
  const hintsContribution: (
    editor: MonacoApi.editor.ICodeEditor,
  ) => ParameterHintsContribution | null = (
    editor: MonacoApi.editor.ICodeEditor,
  ): ParameterHintsContribution | null =>
    editor.getContribution<ParameterHintsContribution>(PARAMETER_HINTS_CONTRIBUTION);
  monaco.editor.registerCommand(
    STUDIO_TRIGGER_SUGGEST_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void =>
      editor.getContribution<SuggestContribution>(SUGGEST_CONTRIBUTION)?.triggerSuggest?.(),
    ),
  );
  monaco.editor.registerCommand(STUDIO_SUGGEST_NEXT_COMMAND, moveTo('next'));
  monaco.editor.registerCommand(STUDIO_SUGGEST_PREVIOUS_COMMAND, moveTo('previous'));
  monaco.editor.registerCommand(STUDIO_SUGGEST_NEXT_PAGE_COMMAND, moveTo('nextPage'));
  monaco.editor.registerCommand(STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND, moveTo('previousPage'));
  monaco.editor.registerCommand(
    STUDIO_SUGGEST_ACCEPT_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void => suggest().accept(editor)),
  );
  monaco.editor.registerCommand(
    STUDIO_SUGGEST_HIDE_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void =>
      editor.getContribution<SuggestContribution>(SUGGEST_CONTRIBUTION)?.cancelSuggestWidget?.(),
    ),
  );
  monaco.editor.registerCommand(
    STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void =>
      hintsContribution(editor)?.trigger?.({ triggerKind: SIGNATURE_HELP_INVOKE }),
    ),
  );
  monaco.editor.registerCommand(
    STUDIO_PARAMETER_HINTS_NEXT_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void => hintsContribution(editor)?.next?.()),
  );
  monaco.editor.registerCommand(
    STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void =>
      hintsContribution(editor)?.previous?.(),
    ),
  );
  monaco.editor.registerCommand(
    STUDIO_PARAMETER_HINTS_HIDE_COMMAND,
    focused((editor: MonacoApi.editor.ICodeEditor): void => hintsContribution(editor)?.cancel?.()),
  );
  monaco.editor.addKeybindingRules(suggestKeybindingRules(monaco, isMac));
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    takeOverSuggestWidget(editor, suggest, suppressed);
    takeOverParameterHintsWidget(editor, hints);
  });
}

/**
 * Builds the keybinding rules of {@link installSuggestCommands}.
 * @param monaco The Monaco instance, whose key codes the rules use.
 * @param isMac Whether the host is macOS.
 * @returns Returns the rules, removals first.
 */
export function suggestKeybindingRules(
  monaco: typeof MonacoApi,
  isMac: boolean,
): MonacoApi.editor.IKeybindingRule[] {
  const { KeyMod, KeyCode }: typeof MonacoApi = monaco;
  const trigger: string = 'editorTextFocus && !editorReadonly';
  const listKeys: string = `${SUGGEST_VISIBLE_CONTEXT_KEY} && !${COMPOSING_CONTEXT_KEY}`;
  const acceptKeys: string = `${listKeys} && ${SUGGEST_FOCUSED_CONTEXT_KEY}`;
  const cardKeys: string = `${PARAMETER_HINTS_VISIBLE_CONTEXT_KEY} && !${SUGGEST_VISIBLE_CONTEXT_KEY} && !${COMPOSING_CONTEXT_KEY}`;
  const overloadKeys: string = `${cardKeys} && ${PARAMETER_HINTS_MULTIPLE_CONTEXT_KEY}`;
  const triggerChords: readonly number[] = isMac
    ? [WIN_CTRL | KeyCode.Space, KeyMod.Alt | KeyCode.Escape, KeyMod.CtrlCmd | KeyCode.KeyI]
    : [KeyMod.CtrlCmd | KeyCode.Space, KeyMod.CtrlCmd | KeyCode.KeyI];
  const rule: (
    keybinding: number,
    command: string,
    when: string,
  ) => MonacoApi.editor.IKeybindingRule = (
    keybinding: number,
    command: string,
    when: string,
  ): MonacoApi.editor.IKeybindingRule => ({ keybinding, command, when });
  return [
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    { keybinding: 0, command: `-${MONACO_TRIGGER_SUGGEST_COMMAND}` },
    { keybinding: 0, command: `-${MONACO_TRIGGER_PARAMETER_HINTS_COMMAND}` },
    ...triggerChords.map((chord: number): MonacoApi.editor.IKeybindingRule =>
      rule(chord, STUDIO_TRIGGER_SUGGEST_COMMAND, trigger),
    ),
    rule(
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space,
      STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND,
      'editorTextFocus',
    ),
    rule(KeyCode.DownArrow, STUDIO_SUGGEST_NEXT_COMMAND, listKeys),
    rule(KeyCode.UpArrow, STUDIO_SUGGEST_PREVIOUS_COMMAND, listKeys),
    rule(KeyCode.PageDown, STUDIO_SUGGEST_NEXT_PAGE_COMMAND, listKeys),
    rule(KeyCode.PageUp, STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND, listKeys),
    rule(KeyCode.Enter, STUDIO_SUGGEST_ACCEPT_COMMAND, acceptKeys),
    rule(KeyCode.Tab, STUDIO_SUGGEST_ACCEPT_COMMAND, acceptKeys),
    rule(KeyCode.Escape, STUDIO_SUGGEST_HIDE_COMMAND, listKeys),
    rule(KeyMod.Shift | KeyCode.Escape, STUDIO_SUGGEST_HIDE_COMMAND, listKeys),
    rule(KeyCode.DownArrow, STUDIO_PARAMETER_HINTS_NEXT_COMMAND, overloadKeys),
    rule(KeyMod.Alt | KeyCode.DownArrow, STUDIO_PARAMETER_HINTS_NEXT_COMMAND, overloadKeys),
    rule(KeyCode.UpArrow, STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND, overloadKeys),
    rule(KeyMod.Alt | KeyCode.UpArrow, STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND, overloadKeys),
    rule(KeyCode.Escape, STUDIO_PARAMETER_HINTS_HIDE_COMMAND, cardKeys),
    rule(KeyMod.Shift | KeyCode.Escape, STUDIO_PARAMETER_HINTS_HIDE_COMMAND, cardKeys),
  ];
}

/**
 * Puts a stand-in in place of Monaco's suggest widget in one editor, before the widget is built: the
 * contribution makes it in an idle value, at window idle, in every editor — so its DOM was on every
 * page whether anything was ever suggested or not. The idle build is cancelled and the stand-in takes
 * its place, so Monaco's suggest model keeps working and Studio's presenter draws what it finds.
 * @param editor The editor.
 * @param presenter Resolves the presenter as it is needed.
 * @param suppressed Determines whether a document's word-based suggestions are left out of the list.
 * @returns Returns true when the contribution was reached and its widget replaced.
 */
export function takeOverSuggestWidget(
  editor: MonacoApi.editor.ICodeEditor,
  presenter: () => SuggestPresenter,
  suppressed: WordSuggestionsSuppressed = (): boolean => false,
): boolean {
  // ⛔ Reaching the contribution makes it if it was not yet made. Making it builds no DOM — its widget
  // waits for window idle — and this runs synchronously, so the build is cancelled before it can run.
  const contribution: SuggestContribution | null =
    editor.getContribution<SuggestContribution>(SUGGEST_CONTRIBUTION);
  if (
    contribution === null ||
    typeof contribution.widget !== 'object' ||
    contribution.widget === null ||
    typeof contribution._insertSuggestion !== 'function'
  ) {
    return false;
  }
  // Cancels the idle build. Were the widget already built, it is still replaced, so it never shows;
  // the specs guard that the takeover reaches every editor before then.
  (contribution.widget as DeferredValue).dispose?.();
  const widget: StudioSuggestWidget = new StudioSuggestWidget(
    editor,
    contribution,
    presenter,
    suppressed,
  );
  contribution.widget = {
    value: widget,
    rawValue: widget,
    isInitialized: true,
    dispose: (): void => widget.dispose(),
  };
  return true;
}

/**
 * Puts a stand-in in place of Monaco's parameter-hints widget in one editor, before it is built (the
 * contribution builds it lazily, the first time signatures arrive), so Studio's presenter draws the
 * signatures Monaco's model finds.
 * @param editor The editor.
 * @param presenter Resolves the presenter as it is needed.
 * @returns Returns true when the contribution was reached and its widget replaced.
 */
export function takeOverParameterHintsWidget(
  editor: MonacoApi.editor.ICodeEditor,
  presenter: () => ParameterHintsPresenter,
): boolean {
  const contribution: ParameterHintsContribution | null =
    editor.getContribution<ParameterHintsContribution>(PARAMETER_HINTS_CONTRIBUTION);
  if (
    contribution === null ||
    typeof contribution.widget !== 'object' ||
    contribution.widget === null
  ) {
    return false;
  }
  contribution.widget = new StudioParameterHintsWidget(editor, contribution, presenter);
  return true;
}
