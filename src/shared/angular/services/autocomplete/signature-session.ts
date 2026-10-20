import type * as MonacoApi from 'monaco-editor';
import {
  ParameterHintsControl,
  PARAMETER_HINTS_MULTIPLE_CONTEXT_KEY,
  PARAMETER_HINTS_VISIBLE_CONTEXT_KEY,
} from '@shared/angular/services/monaco/monaco-suggest-commands';
import { SignatureView, signatureView } from './signature-content';
import type { EditorOrigin } from './suggest-session';

/**
 * The signature card on screen, as a session drives it.
 */
export interface SignatureSurface {
  /**
   * Shows what the card shows.
   * @param view The card's view.
   */
  update(view: SignatureView): void;

  /**
   * Places the card against the caret's line, or hides it while the line is out of sight.
   * @param origin The line's box, or null when it cannot be seen.
   */
  place(origin: EditorOrigin | null): void;

  /**
   * Takes the card away.
   */
  dispose(): void;
}

/**
 * What a session needs from its host: the card's surface and the frame it batches through.
 */
export interface SignatureSessionHost {
  /**
   * Puts the card on screen.
   * @param origin The line it is placed against.
   * @param control Receives the card's overload buttons.
   * @returns Returns the surface.
   */
  present(origin: EditorOrigin, control: ParameterHintsControl): SignatureSurface;

  /**
   * Runs a function at the next frame.
   * @param run The function.
   * @returns Returns a function that cancels it.
   */
  frame(run: () => void): () => void;
}

/**
 * Drives Studio's signature card in one editor (#1021), from Monaco's parameter-hints model: the model
 * finds the signatures as arguments are typed — on the server's trigger characters, and as the caret
 * moves within the call — and the card shows the active one above the caret with its active parameter
 * highlighted, and which overload it is. The editor's context keys say while the card shows and
 * whether it has overloads to step through, which is when ↑ and ↓ (and Escape) reach it. Drawing is
 * batched to one update a frame, following the caret.
 */
export class SignatureSession {
  /**
   * Holds what the card shows, or null while it does not show.
   */
  private view: SignatureView | null = null;

  /**
   * Holds the session of Monaco's model the card shows.
   */
  private control: ParameterHintsControl | null = null;

  /**
   * Holds the card on screen, or null before it first draws.
   */
  private surface: SignatureSurface | null = null;

  /**
   * Holds the function that cancels the pending frame, or null when none is pending.
   */
  private pendingFrame: (() => void) | null = null;

  /**
   * Holds the context key that says the card shows.
   */
  private readonly visibleKey: MonacoApi.editor.IContextKey<boolean>;

  /**
   * Holds the context key that says the card has overloads.
   */
  private readonly multipleKey: MonacoApi.editor.IContextKey<boolean>;

  /**
   * Holds the editor subscriptions, released with the session.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Initializes a new instance of the {@link SignatureSession} class: makes the editor's context keys,
   * and follows its caret and scrolling.
   * @param editor The editor.
   * @param host The host.
   */
  public constructor(
    private readonly editor: MonacoApi.editor.ICodeEditor,
    private readonly host: SignatureSessionHost,
  ) {
    this.visibleKey = contextKey(editor, PARAMETER_HINTS_VISIBLE_CONTEXT_KEY);
    this.multipleKey = contextKey(editor, PARAMETER_HINTS_MULTIPLE_CONTEXT_KEY);
    this.subscriptions.push(
      editor.onDidChangeCursorPosition((): void => this.render()),
      editor.onDidScrollChange((): void => this.render()),
      editor.onDidLayoutChange((): void => this.render()),
    );
  }

  /**
   * Shows (or updates) the card.
   * @param control The session.
   * @param hints The signatures.
   */
  public show(control: ParameterHintsControl, hints: MonacoApi.languages.SignatureHelp): void {
    const view: SignatureView | null = signatureView(hints);
    if (view === null) {
      this.hide();
      return;
    }
    this.control = control;
    this.view = view;
    this.visibleKey.set(true);
    this.multipleKey.set(view.overload !== null);
    this.render();
  }

  /**
   * Takes the card away.
   */
  public hide(): void {
    this.pendingFrame?.();
    this.pendingFrame = null;
    this.surface?.dispose();
    this.surface = null;
    this.view = null;
    this.control = null;
    this.visibleKey.set(false);
    this.multipleKey.set(false);
  }

  /**
   * Gets whether the card shows.
   * @returns Returns true when it does.
   */
  public get showing(): boolean {
    return this.view !== null;
  }

  /**
   * Takes the card away and releases the editor's subscriptions.
   */
  public dispose(): void {
    this.hide();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  /**
   * Asks for a draw at the next frame, once however many changes come before it.
   */
  private render(): void {
    if (this.view === null || this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = this.host.frame((): void => {
      this.pendingFrame = null;
      this.draw();
    });
  }

  /**
   * Draws the card: puts it on screen the first time the caret can be seen, shows its view, and places
   * it above the caret (or hides it while the caret is out of sight).
   */
  private draw(): void {
    const view: SignatureView | null = this.view;
    const control: ParameterHintsControl | null = this.control;
    if (view === null || control === null) {
      return;
    }
    const origin: EditorOrigin | null = this.origin();
    if (this.surface === null) {
      if (origin === null) {
        return;
      }
      this.surface = this.host.present(origin, control);
    }
    this.surface.update(view);
    this.surface.place(origin);
  }

  /**
   * Measures the caret's line from the caret, in client pixels.
   * @returns Returns the box, or null when the caret's line cannot be seen.
   */
  private origin(): EditorOrigin | null {
    const position: MonacoApi.Position | null = this.editor.getPosition();
    if (position === null) {
      return null;
    }
    const at: { top: number; left: number; height: number } | null =
      this.editor.getScrolledVisiblePosition(position);
    const box: DOMRect = this.editor.getContainerDomNode().getBoundingClientRect();
    if (at === null || at.top + at.height <= 0 || at.top >= box.height) {
      return null;
    }
    return { x: box.left + at.left, y: box.top + at.top, width: 0, height: at.height };
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
