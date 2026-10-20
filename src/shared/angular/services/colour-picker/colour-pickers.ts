import {
  ConnectedPosition,
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ComponentRef, inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import {
  ColourChoice,
  ColourPicker,
  PickMode,
} from '@shared/angular/components/colour-picker/colour-picker';
import { Log } from '@shared/angular/services/log/log';
import {
  ProvidedColour,
  providedColourAt,
  providedColourEdits,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { COLOUR_SWATCH_CLASS } from '@shared/angular/services/monaco/monaco-widget-guard';
import { formatColour, parseColour, ParsedColour, Rgba } from './colours';

/**
 * Names the source Studio's colour edits are made under.
 */
const EDIT_SOURCE: string = 'studio.colourPicker';

/**
 * Holds Monaco's `MouseTargetType.CONTENT_TEXT`: a click on the text, which a swatch is part of.
 */
const CONTENT_TEXT: MonacoApi.editor.MouseTargetType = 6;

/**
 * Holds how far the picker stands off the swatch, in CSS pixels.
 */
const PICKER_GAP: number = 4;

/**
 * Places the picker below the swatch, from its start, and flips it above when there is no room below.
 */
const PICKER_POSITIONS: readonly ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: PICKER_GAP },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -PICKER_GAP },
];

/**
 * A swatch the picker was opened for: its editor, the colour's span and what it says.
 */
export interface ColourSwatch {
  /**
   * Gets the span of the colour's text, one-based.
   */
  readonly range: MonacoApi.IRange;

  /**
   * Gets the colour's text as written.
   */
  readonly text: string;

  /**
   * Gets the colour and how it was written, or null when Studio cannot read the text and the colour's
   * provider writes the new one.
   */
  readonly parsed: ParsedColour | null;

  /**
   * Gets the colour as the provider found it, when Studio could not read the text; null otherwise.
   */
  readonly provided: ProvidedColour | null;
}

/**
 * The picker showing, and what it was opened for.
 */
interface OpenPicker {
  /**
   * Gets the editor the swatch is in.
   */
  readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Gets the swatch.
   */
  readonly swatch: ColourSwatch;

  /**
   * Gets the document's version as the picker opened, so a colour is not written over text that has
   * changed under it.
   */
  readonly version: number;

  /**
   * Gets the overlay the picker is drawn in.
   */
  readonly overlay: OverlayRef;
}

/**
 * Opens Studio's colour picker (#1025) when a colour swatch is clicked, in place of Monaco's. Monaco
 * still draws the swatches — a decoration before each colour a language's document-colour provider
 * finds (the CSS worker's for CSS, SCSS and Less, the JSON worker's, or any other) — but its own picker
 * never builds: the editors are made with `colorDecoratorsActivatedOn: 'hover'`, so Monaco's click
 * route does nothing, and its hover is Studio's. Each editor attached here has its clicks on a swatch
 * open the {@link ColourPicker} beside the swatch, in the editor's window.
 *
 * The colour's text is read as written (hex, `rgb()`, `hsl()`, or a name), and the picked colour is
 * written back the same way — or as the picker's format switcher says — over the colour's span, as one
 * edit and one undo step. Text Studio cannot read (a language's own notation) is read by the provider
 * that found the colour, and the new colour written as that provider first offers.
 */
@Service()
export class ColourPickers {
  /**
   * Holds the root injector, which draws the picker in the main window when an editor's own is not
   * known.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the injector of the component each attached editor is in, which decides the window its
   * picker is drawn in.
   */
  private readonly attachments: WeakMap<MonacoApi.editor.ICodeEditor, Injector> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    Injector
  >();

  /**
   * Holds the pick mode the last picker was left in, which the next opens in.
   */
  private mode: PickMode = 'wheel';

  /**
   * Holds the picker showing, or null.
   */
  private open: OpenPicker | null = null;

  /**
   * Holds a count of the pickers asked for, so one whose colour was still being read when another was
   * asked for is dropped.
   */
  private requests: number = 0;

  /**
   * Attaches an editor: a click on a colour swatch opens Studio's picker beside it, drawn in the
   * window of the component the editor is in.
   * @param editor The editor.
   * @param injector The injector of the component the editor is in.
   * @returns Returns a function that detaches the editor and closes its picker.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, injector: Injector): () => void {
    this.attachments.set(editor, injector);
    const subscription: MonacoApi.IDisposable = editor.onMouseDown(
      (event: MonacoApi.editor.IEditorMouseEvent): void => {
        const position: MonacoApi.Position | null = swatchClicked(event);
        if (position === null) {
          return;
        }
        // Monaco has moved the caret to the colour already, as for any click on the text; the picker
        // opens over it and takes the keyboard once drawn.
        const element: HTMLElement | null = event.target.element;
        void this.openAt(editor, position, element?.getBoundingClientRect() ?? null);
      },
    );
    return (): void => {
      subscription.dispose();
      this.attachments.delete(editor);
      if (this.open?.editor === editor) {
        this.close(false);
      }
    };
  }

  /**
   * Opens the picker for the swatch at a position, beside it — what a click on the swatch does.
   * Nothing opens in a read-only editor, or where there is no swatch or its colour cannot be read.
   * @param editor The editor.
   * @param position The swatch's position: the start of its colour.
   * @param anchor The swatch's box on screen, or null to place the picker at the colour's text.
   * @returns Returns a promise resolving to true when the picker opened.
   */
  public async openAt(
    editor: MonacoApi.editor.ICodeEditor,
    position: MonacoApi.IPosition,
    anchor: DOMRect | null,
  ): Promise<boolean> {
    const request: number = ++this.requests;
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null || monaco === undefined) {
      return false;
    }
    if (editor.getOption(monaco.editor.EditorOption.readOnly)) {
      this.log.debug('colourPicker', 'The editor is read-only; no colour picker');
      return false;
    }
    const range: MonacoApi.IRange | null = swatchRange(editor, position);
    if (range === null) {
      this.log.debug('colourPicker', 'No colour swatch at the position');
      return false;
    }
    const version: number = model.getVersionId();
    const text: string = model.getValueInRange(range);
    const parsed: ParsedColour | null = parseColour(text);
    const provided: ProvidedColour | null =
      parsed === null ? await providedColourAt(monaco, model, range) : null;
    if (request !== this.requests || model.getVersionId() !== version) {
      return false;
    }
    if (parsed === null && provided === null) {
      this.log.warn('colourPicker', 'The colour could not be read', text);
      return false;
    }
    this.close(false);
    const swatch: ColourSwatch = { range, text, parsed, provided };
    const colour: Rgba = parsed?.colour ?? fromMonacoColor(provided!.info.color);
    const injector: Injector = this.attachments.get(editor) ?? this.injector;
    const origin: DOMRect = anchor ?? textBox(monaco, editor, range);
    const overlay: OverlayRef = createOverlayRef(injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(injector, {
        x: origin.left,
        y: origin.top,
        width: origin.width,
        height: origin.height,
      })
        .withPositions([...PICKER_POSITIONS])
        .withViewportMargin(8)
        .withPush(true),
      // A click anywhere else cancels, as Escape does: nothing is written but by Apply or Enter.
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      disposeOnNavigation: true,
      panelClass: 'colour-picker-overlay',
    });
    const open: OpenPicker = { editor, swatch, version, overlay };
    this.open = open;
    const picker: ComponentRef<ColourPicker> = overlay.attach(
      new ComponentPortal(ColourPicker, null, injector),
    );
    picker.setInput('colour', colour);
    picker.setInput('format', parsed?.format ?? null);
    picker.setInput('mode', this.mode);
    picker.instance.modeChange.subscribe((mode: PickMode): void => {
      this.mode = mode;
    });
    picker.instance.applied.subscribe(
      (choice: ColourChoice): void => void this.apply(open, choice),
    );
    picker.instance.cancelled.subscribe((): void => this.cancel(open));
    overlay.backdropClick().subscribe((): void => this.cancel(open));
    // Escape with the keyboard outside the picker (on the backdrop) cancels too.
    overlay.keydownEvents().subscribe((event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel(open);
      }
    });
    this.log.info('colourPicker', 'Colour picker opened', text);
    return true;
  }

  /**
   * Writes the picked colour over the swatch's colour, as one edit and one undo step, and closes the
   * picker. Nothing is written when the document changed under the picker, or the text would not
   * change.
   * @param open The picker.
   * @param choice The colour, and the format to write it in.
   */
  private async apply(open: OpenPicker, choice: ColourChoice): Promise<void> {
    const { editor, swatch } = open;
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    this.close(true);
    if (model === null || monaco === undefined) {
      return;
    }
    const edits: readonly MonacoApi.languages.TextEdit[] =
      choice.format !== null
        ? [{ range: swatch.range, text: formatColour(choice.colour, choice.format) }]
        : swatch.provided === null
          ? []
          : await providedColourEdits(monaco, model, swatch.provided, toMonacoColor(choice.colour));
    if (model.getVersionId() !== open.version || editor.getModel() !== model) {
      this.log.warn(
        'colourPicker',
        'The document changed under the colour picker; nothing written',
      );
      return;
    }
    if (edits.length === 0) {
      this.log.warn('colourPicker', 'The colour provider offered no way to write the colour');
      return;
    }
    if (edits.length === 1 && edits[0].text === swatch.text) {
      this.log.debug('colourPicker', 'The colour is unchanged');
      return;
    }
    editor.pushUndoStop();
    editor.executeEdits(
      EDIT_SOURCE,
      edits.map(
        (edit: MonacoApi.languages.TextEdit): MonacoApi.editor.IIdentifiedSingleEditOperation => ({
          range: monaco.Range.lift(edit.range),
          text: edit.text,
          forceMoveMarkers: true,
        }),
      ),
    );
    editor.pushUndoStop();
    this.log.info('colourPicker', 'Colour written', edits[0].text);
  }

  /**
   * Closes the picker without writing anything.
   * @param open The picker.
   */
  private cancel(open: OpenPicker): void {
    if (this.open === open) {
      this.log.debug('colourPicker', 'Colour picker cancelled');
      this.close(true);
    }
  }

  /**
   * Closes the picker showing, if any.
   * @param focus Whether its editor gets the keyboard back.
   */
  private close(focus: boolean): void {
    const open: OpenPicker | null = this.open;
    if (open === null) {
      return;
    }
    this.open = null;
    open.overlay.dispose();
    if (focus) {
      open.editor.focus();
    }
  }
}

/**
 * Determines whether a mouse-down in an editor is a primary-button click on a colour swatch, which
 * Monaco draws as text injected before the colour, carrying {@link COLOUR_SWATCH_CLASS}.
 * @param event The mouse-down.
 * @returns Returns the swatch's position — the start of its colour — or null when it is not one.
 */
export function swatchClicked(
  event: MonacoApi.editor.IEditorMouseEvent,
): MonacoApi.Position | null {
  const { target } = event;
  return event.event.leftButton &&
    target.type === CONTENT_TEXT &&
    target.element?.classList.contains(COLOUR_SWATCH_CLASS) === true
    ? target.position
    : null;
}

/**
 * Finds the span of the colour whose swatch is at a position: the colour decorator's decoration on
 * the position's line that starts nearest it.
 * @param editor The editor.
 * @param position The swatch's position.
 * @returns Returns the colour's span, or null when the line has no swatch.
 */
export function swatchRange(
  editor: MonacoApi.editor.ICodeEditor,
  position: MonacoApi.IPosition,
): MonacoApi.IRange | null {
  const swatches: readonly MonacoApi.editor.IModelDecoration[] = (
    editor.getLineDecorations(position.lineNumber) ?? []
  ).filter(
    (decoration: MonacoApi.editor.IModelDecoration): boolean =>
      decoration.options.before?.inlineClassName?.split(/\s+/).includes(COLOUR_SWATCH_CLASS) ===
      true,
  );
  let nearest: MonacoApi.editor.IModelDecoration | null = null;
  for (const swatch of swatches) {
    if (
      swatch.range.startLineNumber === position.lineNumber &&
      (nearest === null ||
        Math.abs(swatch.range.startColumn - position.column) <
          Math.abs(nearest.range.startColumn - position.column))
    ) {
      nearest = swatch;
    }
  }
  return nearest?.range ?? null;
}

/**
 * Finds the box on screen of a colour's text, for a picker opened without a swatch to stand by.
 * @param monaco The editor's Monaco instance, whose option numbers are read.
 * @param editor The editor.
 * @param range The colour's span.
 * @returns Returns the box, in the window's coordinates.
 */
function textBox(
  monaco: typeof MonacoApi,
  editor: MonacoApi.editor.ICodeEditor,
  range: MonacoApi.IRange,
): DOMRect {
  const host: DOMRect = editor.getDomNode()?.getBoundingClientRect() ?? new DOMRect();
  const at: MonacoApi.editor.IContentWidgetRenderedCoordinate | null =
    editor.getScrolledVisiblePosition({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
  return at === null
    ? new DOMRect(host.left, host.top, 0, 0)
    : new DOMRect(
        host.left + at.left,
        host.top + at.top,
        0,
        editor.getOption(monaco.editor.EditorOption.lineHeight),
      );
}

/**
 * Converts a Monaco colour, each channel 0–1, to the picker's.
 * @param color The Monaco colour.
 * @returns Returns the colour.
 */
function fromMonacoColor(color: MonacoApi.languages.IColor): Rgba {
  return {
    red: color.red * 255,
    green: color.green * 255,
    blue: color.blue * 255,
    alpha: color.alpha,
  };
}

/**
 * Converts the picker's colour to a Monaco colour, each channel 0–1.
 * @param colour The colour.
 * @returns Returns the Monaco colour.
 */
function toMonacoColor(colour: Rgba): MonacoApi.languages.IColor {
  return {
    red: colour.red / 255,
    green: colour.green / 255,
    blue: colour.blue / 255,
    alpha: colour.alpha,
  };
}

/**
 * Resolves the Monaco instance an editor belongs to: the one loaded into its window, since each
 * window has its own.
 * @param editor The editor.
 * @returns Returns the instance, or undefined when its window has none.
 */
function instanceOf(editor: MonacoApi.editor.ICodeEditor): typeof MonacoApi | undefined {
  const view: (Window & { monaco?: typeof MonacoApi }) | null =
    editor.getContainerDomNode().ownerDocument.defaultView;
  return view?.monaco ?? (window as Window & { monaco?: typeof MonacoApi }).monaco;
}
