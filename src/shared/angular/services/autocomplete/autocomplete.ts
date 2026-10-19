import {
  ConnectedPosition,
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  FlexibleConnectedPositionStrategy,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ComponentRef, inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  CompletionList,
  CompletionListView,
} from '@shared/angular/components/completion-list/completion-list';
import { SignatureCard } from '@shared/angular/components/signature-card/signature-card';
import { Log } from '@shared/angular/services/log/log';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import type {
  ParameterHintsControl,
  ParameterHintsPresenter,
  SuggestControl,
  SuggestItem,
  SuggestList,
  SuggestMove,
  SuggestPresenter,
} from '@shared/angular/services/monaco/monaco-suggest-commands';
import type { SignatureView } from './signature-content';
import { SignatureSession, SignatureSurface } from './signature-session';
import {
  Cancellation,
  CompletionSurface,
  EditorOrigin,
  SuggestSession,
  SuggestSessionHost,
} from './suggest-session';

/**
 * Holds how far the list and the card stand off the line they are placed against, in CSS pixels.
 */
const GAP: number = 2;

/**
 * Places the completion list under the word being typed, and flips it above when there is no room
 * under — from the word's start, or ending at the window's edge when the word is near it.
 */
const LIST_POSITIONS: readonly ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: GAP },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -GAP },
  { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: GAP },
  { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -GAP },
];

/**
 * Places the signature card above the caret — clear of the completion list under it — and flips it
 * under when there is no room above.
 */
const CARD_POSITIONS: readonly ConnectedPosition[] = [
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -GAP },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: GAP },
];

/**
 * Shows Studio's completion list and signature card (#1021), in place of Monaco's suggest and
 * parameter-hints widgets. Monaco's own models still decide when to suggest — as an identifier is
 * typed, on the language's trigger characters, on ⌃Space — and rank what the providers answer; the
 * takeover (`monaco-suggest-commands`) hands each answer here, and each editor's
 * {@link SuggestSession} and {@link SignatureSession} draw it.
 *
 * The list and the card are drawn in a CDK overlay of the editor's window — built from the injector of
 * the component the editor is in, so an editor in a popped-out window draws them there. An editor no
 * component attached is drawn for from the main window's injector, when it is in the main window.
 */
@Service()
export class Autocomplete implements SuggestPresenter, ParameterHintsPresenter {
  /**
   * Holds the main window's injector, which draws for an editor no component attached.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the injector of the component each attached editor is in.
   */
  private readonly attachments: WeakMap<MonacoApi.editor.ICodeEditor, Injector> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    Injector
  >();

  /**
   * Holds each editor's completion list session, made the first time it suggests.
   */
  private readonly lists: WeakMap<MonacoApi.editor.ICodeEditor, SuggestSession> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    SuggestSession
  >();

  /**
   * Holds each editor's signature card session, made the first time it has signatures.
   */
  private readonly cards: WeakMap<MonacoApi.editor.ICodeEditor, SignatureSession> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    SignatureSession
  >();

  /**
   * Initializes a new instance of the {@link Autocomplete} class, handing it to Monaco's takeover as
   * what draws every editor's list and card.
   */
  public constructor() {
    inject(Monaco).useAssist(this);
  }

  /**
   * Attaches an editor: its list and card are drawn in the window of the component it is in.
   * @param editor The editor.
   * @param injector The injector of the component the editor is in.
   * @returns Returns a function that detaches the editor and takes its list and card away.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, injector: Injector): () => void {
    this.attachments.set(editor, injector);
    return (): void => {
      if (this.attachments.get(editor) === injector) {
        this.attachments.delete(editor);
      }
      this.lists.get(editor)?.dispose();
      this.lists.delete(editor);
      this.cards.get(editor)?.dispose();
      this.cards.delete(editor);
    };
  }

  /**
   * Determines whether an editor's completion list or signature card shows.
   * @param editor The editor.
   * @returns Returns true when either shows.
   */
  public showing(editor: MonacoApi.editor.ICodeEditor): boolean {
    return this.lists.get(editor)?.showing === true || this.cards.get(editor)?.showing === true;
  }

  /**
   * Starts showing a suggest session in an editor.
   * @param editor The editor.
   * @param control The session.
   * @param auto Whether it started on its own.
   * @param delay How long to wait before saying it is loading, in milliseconds.
   */
  public triggered(
    editor: MonacoApi.editor.ICodeEditor,
    control: SuggestControl,
    auto: boolean,
    delay: number,
  ): void {
    this.listOf(editor)?.triggered(control, auto, delay);
  }

  /**
   * Shows an answer of a suggest session in an editor.
   * @param editor The editor.
   * @param control The session.
   * @param list The answer.
   */
  public suggestions(
    editor: MonacoApi.editor.ICodeEditor,
    control: SuggestControl,
    list: SuggestList,
  ): void {
    this.listOf(editor)?.suggestions(control, list);
  }

  /**
   * Takes an editor's list away.
   * @param editor The editor.
   */
  public hidden(editor: MonacoApi.editor.ICodeEditor): void {
    this.lists.get(editor)?.hidden();
  }

  /**
   * Gets an editor's focused completion.
   * @param editor The editor.
   * @returns Returns the item, or undefined when none is focused.
   */
  public focusedItem(editor: MonacoApi.editor.ICodeEditor): SuggestItem | undefined {
    return this.lists.get(editor)?.focusedItem();
  }

  /**
   * Moves an editor's list focus.
   * @param editor The editor.
   * @param move Where to.
   */
  public move(editor: MonacoApi.editor.ICodeEditor, move: SuggestMove): void {
    this.lists.get(editor)?.move(move);
  }

  /**
   * Accepts an editor's focused completion.
   * @param editor The editor.
   */
  public accept(editor: MonacoApi.editor.ICodeEditor): void {
    if (this.lists.get(editor)?.accept() !== true) {
      this.log.debug('autocomplete', 'Nothing to accept');
    }
  }

  /**
   * Shows (or updates) an editor's signature card.
   * @param editor The editor.
   * @param control The session.
   * @param hints The signatures.
   */
  public showSignatures(
    editor: MonacoApi.editor.ICodeEditor,
    control: ParameterHintsControl,
    hints: MonacoApi.languages.SignatureHelp,
  ): void {
    this.cardOf(editor)?.show(control, hints);
  }

  /**
   * Takes an editor's signature card away.
   * @param editor The editor.
   */
  public hideSignatures(editor: MonacoApi.editor.ICodeEditor): void {
    this.cards.get(editor)?.hide();
  }

  /**
   * Gets an editor's list session, making it the first time.
   * @param editor The editor.
   * @returns Returns the session, or null when the editor has no window to draw in.
   */
  private listOf(editor: MonacoApi.editor.ICodeEditor): SuggestSession | null {
    let session: SuggestSession | undefined = this.lists.get(editor);
    if (session !== undefined) {
      return session;
    }
    const injector: Injector | null = this.injectorOf(editor);
    if (injector === null) {
      return null;
    }
    session = new SuggestSession(editor, this.listHost(editor, injector));
    this.lists.set(editor, session);
    return session;
  }

  /**
   * Gets an editor's card session, making it the first time.
   * @param editor The editor.
   * @returns Returns the session, or null when the editor has no window to draw in.
   */
  private cardOf(editor: MonacoApi.editor.ICodeEditor): SignatureSession | null {
    let session: SignatureSession | undefined = this.cards.get(editor);
    if (session !== undefined) {
      return session;
    }
    const injector: Injector | null = this.injectorOf(editor);
    if (injector === null) {
      return null;
    }
    session = new SignatureSession(editor, {
      present: (origin: EditorOrigin, control: ParameterHintsControl): SignatureSurface =>
        this.presentCard(injector, origin, control),
      frame: (run: () => void): (() => void) => frameIn(editor, run),
    });
    this.cards.set(editor, session);
    return session;
  }

  /**
   * Resolves the injector an editor's list and card are drawn from: the component's it is in, or the
   * main window's for an editor in the main window no component attached.
   * @param editor The editor.
   * @returns Returns the injector, or null when the editor is in another window and unattached.
   */
  private injectorOf(editor: MonacoApi.editor.ICodeEditor): Injector | null {
    const attached: Injector | undefined = this.attachments.get(editor);
    if (attached !== undefined) {
      return attached;
    }
    if (editor.getContainerDomNode().ownerDocument === document) {
      return this.injector;
    }
    this.log.debug('autocomplete', 'No component attached an editor of another window');
    return null;
  }

  /**
   * Builds the host of an editor's list session.
   * @param editor The editor.
   * @param injector The injector the list is drawn from.
   * @returns Returns the host.
   */
  private listHost(editor: MonacoApi.editor.ICodeEditor, injector: Injector): SuggestSessionHost {
    return {
      present: (origin: EditorOrigin, chosen: (index: number) => void): CompletionSurface =>
        this.presentList(injector, origin, chosen),
      frame: (run: () => void): (() => void) => frameIn(editor, run),
      delay: (run: () => void, delay: number): (() => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(run, delay);
        return (): void => clearTimeout(timer);
      },
      cancellation: (): Cancellation => cancellationIn(editor),
    };
  }

  /**
   * Puts a completion list on screen, in a CDK overlay of the injector's window: under the word, and
   * flipping above.
   * @param injector The injector.
   * @param origin The line it is placed against.
   * @param chosen Receives the index of a row clicked.
   * @returns Returns the list's surface.
   */
  private presentList(
    injector: Injector,
    origin: EditorOrigin,
    chosen: (index: number) => void,
  ): CompletionSurface {
    const { overlay, strategy }: Overlaid = overlaid(
      injector,
      origin,
      LIST_POSITIONS,
      'completion-list-overlay',
    );
    const list: ComponentRef<CompletionList> = overlay.attach(
      new ComponentPortal(CompletionList, null, injector),
    );
    list.instance.chosen.subscribe(chosen);
    return {
      update: (view: CompletionListView): void => {
        list.setInput('view', view);
        list.changeDetectorRef.detectChanges();
      },
      place: (at: EditorOrigin | null): void => place(overlay, strategy, at),
      dispose: (): void => overlay.dispose(),
    };
  }

  /**
   * Puts a signature card on screen, in a CDK overlay of the injector's window: above the caret, and
   * flipping under.
   * @param injector The injector.
   * @param origin The line it is placed against.
   * @param control Receives the card's overload buttons.
   * @returns Returns the card's surface.
   */
  private presentCard(
    injector: Injector,
    origin: EditorOrigin,
    control: ParameterHintsControl,
  ): SignatureSurface {
    const { overlay, strategy }: Overlaid = overlaid(
      injector,
      origin,
      CARD_POSITIONS,
      'signature-card-overlay',
    );
    const card: ComponentRef<SignatureCard> = overlay.attach(
      new ComponentPortal(SignatureCard, null, injector),
    );
    card.instance.previous.subscribe((): void => control.previous());
    card.instance.next.subscribe((): void => control.next());
    return {
      update: (view: SignatureView): void => {
        card.setInput('view', view);
        card.changeDetectorRef.detectChanges();
      },
      place: (at: EditorOrigin | null): void => place(overlay, strategy, at),
      dispose: (): void => overlay.dispose(),
    };
  }
}

/**
 * An overlay and the strategy that places it.
 */
interface Overlaid {
  /**
   * Gets the overlay.
   */
  readonly overlay: OverlayRef;

  /**
   * Gets the strategy that places it against its line.
   */
  readonly strategy: FlexibleConnectedPositionStrategy;
}

/**
 * Makes an overlay placed against a line. No backdrop: neither the list nor the card is modal, and the
 * text under them keeps its pointer. No scroll strategy: the session re-places them as the editor
 * scrolls, and hides them while their line is out of sight.
 * @param injector The injector, which decides the window.
 * @param origin The line.
 * @param positions Where it may go, in order.
 * @param panelClass The overlay pane's class.
 * @returns Returns the overlay and its strategy.
 */
function overlaid(
  injector: Injector,
  origin: EditorOrigin,
  positions: readonly ConnectedPosition[],
  panelClass: string,
): Overlaid {
  const strategy: FlexibleConnectedPositionStrategy = createFlexibleConnectedPositionStrategy(
    injector,
    origin,
  )
    .withPositions([...positions])
    .withViewportMargin(4)
    .withFlexibleDimensions(false)
    .withPush(false);
  const overlay: OverlayRef = createOverlayRef(injector, {
    positionStrategy: strategy,
    disposeOnNavigation: true,
    panelClass,
  });
  return { overlay, strategy };
}

/**
 * Places an overlay against a line, or hides it while the line is out of sight.
 * @param overlay The overlay.
 * @param strategy The strategy that places it.
 * @param origin The line, or null.
 */
function place(
  overlay: OverlayRef,
  strategy: FlexibleConnectedPositionStrategy,
  origin: EditorOrigin | null,
): void {
  overlay.hostElement.style.visibility = origin === null ? 'hidden' : '';
  if (origin !== null) {
    strategy.setOrigin(origin);
    overlay.updatePosition();
  }
}

/**
 * Runs a function at the next frame of an editor's window.
 * @param editor The editor.
 * @param run The function.
 * @returns Returns a function that cancels it.
 */
function frameIn(editor: MonacoApi.editor.ICodeEditor, run: () => void): () => void {
  const view: Window = editor.getContainerDomNode().ownerDocument.defaultView ?? window;
  const handle: number = view.requestAnimationFrame(run);
  return (): void => view.cancelAnimationFrame(handle);
}

/**
 * Makes a cancellation of the Monaco instance an editor belongs to: the one loaded into its window.
 * @param editor The editor.
 * @returns Returns the cancellation.
 */
function cancellationIn(editor: MonacoApi.editor.ICodeEditor): Cancellation {
  const view: Window | null = editor.getContainerDomNode().ownerDocument.defaultView;
  const monaco: typeof MonacoApi | undefined = view?.monaco ?? window.monaco;
  if (monaco === undefined) {
    // No Monaco to make one with (only in specs): a token that is never cancelled.
    const token: MonacoApi.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
    };
    return { token, cancel: (): void => undefined, dispose: (): void => undefined };
  }
  const source: MonacoApi.CancellationTokenSource = new monaco.CancellationTokenSource();
  return {
    token: source.token,
    cancel: (): void => source.cancel(),
    dispose: (): void => source.dispose(),
  };
}
