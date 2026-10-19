import {
  ConnectedPosition,
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ComponentRef, inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { HoverCard } from '@shared/angular/components/hover-card/hover-card';
import { Log } from '@shared/angular/services/log/log';
import {
  ProvidedHover,
  providedHovers,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import type { ProblemDirection } from '@shared/angular/services/monaco/monaco-hover-commands';
import { QuickFixes } from '@shared/angular/services/quick-fix/quick-fixes';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import {
  decorationMessages,
  glyphMessages,
  HoverCardController,
  HoverCardHandle,
  HoverCardOrigin,
  HoverSpot,
} from './hover-card-controller';
import {
  HoverCardContent,
  HoverProblem,
  hoverSections,
  problemFrom,
  problemsAt,
} from './hover-content';

/**
 * Holds how far a card stands off the spot it is about, in CSS pixels.
 */
const CARD_GAP: number = 4;

/**
 * Holds Monaco's `ScrollType.Immediate`; see {@link HoverCardController}.
 */
const SCROLL_IMMEDIATE: MonacoApi.editor.ScrollType = 1;

/**
 * Places a card above the spot it is about, from the spot's start, and flips it below when there is
 * no room above — as Monaco's hover was placed.
 */
const CARD_POSITIONS: readonly ConnectedPosition[] = [
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -CARD_GAP },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: CARD_GAP },
];

/**
 * One editor's card, and the injector of the component the editor is in.
 */
interface Attachment {
  /**
   * Gets the editor's card.
   */
  readonly controller: HoverCardController;

  /**
   * Gets the injector of the component the editor is in, which decides the window the card is drawn
   * in.
   */
  readonly injector: Injector;
}

/**
 * Shows Studio's hover cards (#1020), in place of Monaco's hover, glyph hover and problem peek. Each
 * editor attached gets a {@link HoverCardController} following its pointer; ⌘K ⌘I (Ctrl+K Ctrl+I)
 * shows the card at the caret, and F8 / ⇧F8 move the caret to the next or previous problem and show
 * its card — each reaching here through Studio's Monaco commands.
 *
 * A card shows what every hover provider for the language says (the language server's and Monaco's
 * own workers', merged as Monaco merges them), the problems on the spot, and what can be done with the
 * symbol. Its choices are carried out here: Quick Fix… moves the caret to the problem and opens
 * Studio's fixes menu; Go to Problem moves the caret there; Go to Definition and Find All References
 * move the caret to the symbol and go through the {@link EditorNavigation}.
 */
@Service()
export class HoverCards {
  /**
   * Holds the injector the quick fixes and the navigation are resolved from as they are needed.
   * Resolved then rather than injected here: they reach into Monaco, whose commands reach back here.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each attached editor's card.
   */
  private readonly attachments: WeakMap<MonacoApi.editor.ICodeEditor, Attachment> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    Attachment
  >();

  /**
   * Attaches an editor: resting the pointer on a symbol, a problem or a gutter decoration shows its
   * card, drawn in the window of the component the editor is in.
   * @param editor The editor.
   * @param injector The injector of the component the editor is in.
   * @returns Returns a function that detaches the editor and takes its card away.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, injector: Injector): () => void {
    const controller: HoverCardController = new HoverCardController(editor, {
      markers: (): readonly MonacoApi.editor.IMarker[] => markersOf(editor),
      content: (spot: HoverSpot): Promise<HoverCardContent | null> => this.contentAt(editor, spot),
      present: (
        content: HoverCardContent,
        spot: HoverSpot,
        origin: HoverCardOrigin,
      ): HoverCardHandle => this.present(editor, content, spot, origin),
    });
    const attachment: Attachment = { controller, injector };
    this.attachments.set(editor, attachment);
    return (): void => {
      controller.dispose();
      if (this.attachments.get(editor) === attachment) {
        this.attachments.delete(editor);
      }
    };
  }

  /**
   * Shows an attached editor's card at a position at once — the caret, for ⌘K ⌘I.
   * @param editor The editor.
   * @param position The one-based position, or undefined for the caret.
   */
  public showAt(editor: MonacoApi.editor.ICodeEditor, position?: MonacoApi.IPosition): void {
    const attachment: Attachment | undefined = this.attachments.get(editor);
    const at: MonacoApi.IPosition | null = position ?? editor.getPosition();
    if (attachment === undefined || at === null) {
      this.log.debug('hover', 'No hover card is attached to the editor');
      return;
    }
    void attachment.controller.showAt(at);
  }

  /**
   * Moves an attached editor's caret to its next or previous problem — wrapping round the document's
   * ends — and shows the problem's card (F8 / ⇧F8).
   * @param editor The editor.
   * @param direction Which way to go.
   */
  public goToProblem(editor: MonacoApi.editor.ICodeEditor, direction: ProblemDirection): void {
    const caret: MonacoApi.Position | null = editor.getPosition();
    const problem: MonacoApi.IRange | null =
      caret === null ? null : problemFrom(markersOf(editor), caret, direction);
    if (problem === null) {
      this.log.debug('hover', 'No problem to go to');
      return;
    }
    this.showProblem(editor, problem);
  }

  /**
   * Moves an attached editor's caret to a problem and shows its card.
   * @param editor The editor.
   * @param problem The problem's span.
   */
  public showProblem(editor: MonacoApi.editor.ICodeEditor, problem: MonacoApi.IRange): void {
    const start: MonacoApi.IPosition = {
      lineNumber: problem.startLineNumber,
      column: problem.startColumn,
    };
    editor.setPosition(start);
    editor.revealRangeInCenterIfOutsideViewport(problem, SCROLL_IMMEDIATE);
    void this.attachments.get(editor)?.controller.showAt(start, problem);
  }

  /**
   * Gathers what a card about a spot shows: for the text, what every hover provider for the language
   * says and the decorations' own messages, the problems on the spot, and what can be done with the
   * symbol; for the gutter, its decorations' descriptions alone.
   * @param editor The editor.
   * @param spot The spot.
   * @returns Returns a promise resolving to the content, or null when the editor has no document.
   */
  public async contentAt(
    editor: MonacoApi.editor.ICodeEditor,
    spot: HoverSpot,
  ): Promise<HoverCardContent | null> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null) {
      return null;
    }
    if (spot.kind === 'gutter') {
      return {
        sections: hoverSections([], glyphMessages(editor, spot.position.lineNumber)),
        problems: [],
        quickFix: false,
        actions: null,
      };
    }
    const hovers: readonly ProvidedHover[] =
      monaco === undefined ? [] : await providedHovers(monaco, model, spot.position);
    const problems: readonly HoverProblem[] = problemsAt(markersOf(editor), spot.position);
    const navigation: EditorNavigation = this.injector.get(EditorNavigation);
    const word: boolean = model.getWordAtPosition(spot.position) !== null;
    return {
      sections: hoverSections(hovers, decorationMessages(editor, spot.position)),
      problems,
      quickFix: problems.length > 0 && this.injector.get(QuickFixes).offersQuickFixes(editor),
      actions: word
        ? {
            definition: navigation.offersDefinitions(editor),
            references: navigation.offersReferences(editor),
            referencesListed: navigation.listsReferences(editor),
          }
        : null,
    };
  }

  /**
   * Shows a card in a CDK overlay of the editor's window — built from the injector of the component
   * the editor is in, so a card over an editor in a popped-out window is drawn there — placed above
   * the spot and flipping below, and wires its choices.
   * @param editor The editor.
   * @param content What the card shows.
   * @param spot The spot it is about.
   * @param origin Where it is placed.
   * @returns Returns the card on screen.
   */
  private present(
    editor: MonacoApi.editor.ICodeEditor,
    content: HoverCardContent,
    spot: HoverSpot,
    origin: HoverCardOrigin,
  ): HoverCardHandle {
    const injector: Injector = this.attachments.get(editor)?.injector ?? this.injector;
    // No backdrop: the card is not modal, and the text under it must keep its pointer. No scroll
    // strategy either: the editor scrolling closes the card (see the controller), and the card is
    // closed — not left detached — whatever else happens.
    const overlay: OverlayRef = createOverlayRef(injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(injector, origin)
        .withPositions([...CARD_POSITIONS])
        .withViewportMargin(8)
        .withPush(true),
      disposeOnNavigation: true,
      panelClass: 'hover-card-overlay',
    });
    const card: ComponentRef<HoverCard> = overlay.attach(
      new ComponentPortal(HoverCard, null, injector),
    );
    card.setInput('content', content);
    card.instance.quickFix.subscribe((problem: HoverProblem): void =>
      this.quickFix(editor, problem),
    );
    card.instance.goToProblem.subscribe((problem: HoverProblem): void =>
      this.goToLocation(editor, problem.range),
    );
    card.instance.goToDefinition.subscribe((): void =>
      this.navigate(editor, spot.position, 'definition'),
    );
    card.instance.findReferences.subscribe((): void =>
      this.navigate(editor, spot.position, 'references'),
    );
    card.instance.dismissed.subscribe((): void => {
      this.hide(editor);
      editor.focus();
    });
    return { element: overlay.overlayElement, dispose: (): void => overlay.dispose() };
  }

  /**
   * Opens Studio's fixes menu at a problem: the card goes, and the caret moves to the problem first,
   * since the menu opens at the caret.
   * @param editor The editor.
   * @param problem The problem.
   */
  private quickFix(editor: MonacoApi.editor.ICodeEditor, problem: HoverProblem): void {
    this.hide(editor);
    editor.setPosition({
      lineNumber: problem.range.startLineNumber,
      column: problem.range.startColumn,
    });
    editor.focus();
    void this.injector.get(QuickFixes).open(editor);
  }

  /**
   * Moves the caret to a problem, revealing it, and gives the editor focus: the card goes.
   * @param editor The editor.
   * @param range The problem's span.
   */
  private goToLocation(editor: MonacoApi.editor.ICodeEditor, range: MonacoApi.IRange): void {
    this.hide(editor);
    editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
    editor.revealRangeInCenterIfOutsideViewport(range);
    editor.focus();
  }

  /**
   * Goes to the definition of the symbol a card is about, or lists its references: the card goes, and
   * the caret moves to the symbol first, since the navigation starts from the caret.
   * @param editor The editor.
   * @param position The symbol's position.
   * @param mode Where to go.
   */
  private navigate(
    editor: MonacoApi.editor.ICodeEditor,
    position: MonacoApi.IPosition,
    mode: 'definition' | 'references',
  ): void {
    this.hide(editor);
    editor.setPosition(position);
    editor.focus();
    const navigation: EditorNavigation = this.injector.get(EditorNavigation);
    void (mode === 'definition'
      ? navigation.goToDefinition(editor)
      : navigation.findReferences(editor));
  }

  /**
   * Takes an attached editor's card away.
   * @param editor The editor.
   */
  private hide(editor: MonacoApi.editor.ICodeEditor): void {
    this.attachments.get(editor)?.controller.hide();
  }
}

/**
 * Reads the problems of an editor's document from its Monaco instance.
 * @param editor The editor.
 * @returns Returns the problems, empty when it has no document or its window has no Monaco.
 */
function markersOf(editor: MonacoApi.editor.ICodeEditor): readonly MonacoApi.editor.IMarker[] {
  const model: MonacoApi.editor.ITextModel | null = editor.getModel();
  const monaco: typeof MonacoApi | undefined = instanceOf(editor);
  return model === null || monaco === undefined
    ? []
    : monaco.editor.getModelMarkers({ resource: model.uri });
}

/**
 * Resolves the Monaco instance an editor belongs to: the one loaded into its window, since each
 * window has its own.
 * @param editor The editor.
 * @returns Returns the instance, or undefined when its window has none.
 */
function instanceOf(editor: MonacoApi.editor.ICodeEditor): typeof MonacoApi | undefined {
  const view: Window | null = editor.getContainerDomNode().ownerDocument.defaultView;
  return view?.monaco ?? window.monaco;
}
