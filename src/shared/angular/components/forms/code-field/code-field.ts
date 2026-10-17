import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { findXmlProblem, XmlProblem } from './xml-well-formedness';

/**
 * The vertical padding, in pixels, drawn inside the editor above the first line and below the last.
 */
const EDITOR_PADDING_PX: number = 8;

/**
 * The line height, in pixels, assumed for the row bounds before the editor has reported its own.
 */
const FALLBACK_LINE_HEIGHT_PX: number = 19;

/**
 * The marker owner the field's own XML well-formedness markers are filed under.
 */
const XML_MARKER_OWNER: string = 'code-field-xml';

/**
 * How long, in milliseconds, XML validation waits after the text last changed, so a body being typed
 * is parsed once it pauses rather than on every keystroke.
 */
const XML_VALIDATE_DEBOUNCE_MS: number = 250;

/**
 * The editor options a code field pins over the settings-derived defaults. A field is a compact,
 * chromeless control, not a page: no line numbers, gutter, minimap, folding, ruler or sticky header,
 * and it grows with its content between its row bounds rather than scrolling within a fixed box.
 * The scrollbar gives the wheel back to the page while the content fits, so a field inside a
 * scrolling form does not trap the scroll.
 */
const FIELD_OPTIONS: MonacoApi.editor.IEditorOptions = {
  lineNumbers: 'off',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 12,
  lineNumbersMinChars: 0,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollBeyondLastLine: false,
  scrollBeyondLastColumn: 0,
  renderLineHighlight: 'none',
  stickyScroll: { enabled: false },
  wordWrap: 'on',
  padding: { top: EDITOR_PADDING_PX, bottom: EDITOR_PADDING_PX },
  scrollbar: { alwaysConsumeMouseWheel: false },
  fixedOverflowWidgets: true,
};

/**
 * The severity of a marker the field reports.
 */
export type CodeFieldMarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * A problem Monaco has marked in the field's text: a JSON syntax error from the JSON language
 * service, an XML well-formedness error from the field's own check, or anything else a language
 * contribution files against the model.
 */
export interface CodeFieldMarker {
  /**
   * Gets the severity.
   */
  readonly severity: CodeFieldMarkerSeverity;

  /**
   * Gets the description of the problem.
   */
  readonly message: string;

  /**
   * Gets the one-based line the problem starts on.
   */
  readonly line: number;

  /**
   * Gets the one-based column the problem starts at.
   */
  readonly column: number;

  /**
   * Gets what reported the problem, or an empty string when the marker did not say.
   */
  readonly source: string;
}

/**
 * Represents a code field: the shared Monaco text editor framed as a form control, so structured text
 * — a JSON request body, an XML payload, a response — is written and read with its syntax coloured,
 * where a plain textarea would show it as a wall of characters. The language is a Monaco language
 * identifier (`json`, `xml`, `plaintext`, …) and can change while the field is mounted.
 *
 * By default the field is at least {@link minRows} tall, grows with its content, and past
 * {@link maxRows} scrolls within its frame rather than growing the page, as a textarea past its rows
 * does. With {@link fill} set it instead fills whatever box its caller gives it, for a field that is
 * the main thing on a pane rather than one control in a form.
 *
 * Problems Monaco marks in the text — JSON syntax errors from its JSON language service, and XML
 * well-formedness errors the field checks itself, since Monaco has no XML service — are reported
 * through {@link markersChange}, so a host can count them in a status strip.
 *
 * Exchanges strings. Setting {@link value} to text the editor does not already hold replaces the editor
 * content; edits report through the model as they are made.
 */
@Component({
  selector: 'app-code-field',
  imports: [TextEditor],
  templateUrl: './code-field.html',
  styleUrl: './code-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.code-field--disabled]': 'disabled()',
    '[class.code-field--read-only]': 'readOnly()',
    '[class.code-field--fill]': 'fill()',
  },
})
export class CodeField {
  /**
   * Holds the Monaco loader, reached for its option and severity enumerations and its marker store.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the framed editor.
   */
  private readonly editor: Signal<TextEditor> = viewChild.required<TextEditor>(TextEditor);

  /**
   * Gets or sets the text.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the Monaco language identifier the text is coloured as.
   */
  public readonly language: InputSignal<string> = input<string>('plaintext');

  /**
   * Gets the accessible name of the field.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the number of text rows the field is at least tall enough for.
   */
  public readonly minRows: InputSignal<number> = input<number>(5);

  /**
   * Gets the number of text rows past which the field scrolls within its frame instead of growing.
   */
  public readonly maxRows: InputSignal<number> = input<number>(20);

  /**
   * Gets a value indicating whether the field fills the box its caller gives it rather than sizing
   * itself to its content. The row bounds do not apply.
   */
  public readonly fill: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the text can be read but not edited.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the field is disabled: read-only and dimmed.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the problems marked in the text whenever they change, and once when the editor is created.
   */
  public readonly markersChange: OutputEmitterRef<readonly CodeFieldMarker[]> =
    output<readonly CodeFieldMarker[]>();

  /**
   * Gets the editor options pinned over the settings-derived defaults.
   */
  protected readonly editorOptions: MonacoApi.editor.IEditorOptions = FIELD_OPTIONS;

  /**
   * Holds whether the Monaco editor has been created.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the editor's line height in pixels, as it last reported it.
   */
  private readonly lineHeight: WritableSignal<number> = signal<number>(FALLBACK_LINE_HEIGHT_PX);

  /**
   * Holds the height in pixels the editor's content wants, or null before the editor has reported
   * one, in which case the field sits at its minimum.
   */
  private readonly contentHeight: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the subscriptions to the editor's size and marker reports, released with the field.
   */
  private subscriptions: readonly MonacoApi.IDisposable[] = [];

  /**
   * Holds the pending XML validation, or null when none is scheduled.
   */
  private xmlTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether the field has filed XML markers against the model, so they are cleared when the
   * language moves away from XML and not otherwise touched.
   */
  private xmlMarkersFiled: boolean = false;

  /**
   * Gets the height in pixels the frame is drawn at when sizing to content: the content's height,
   * held between the row bounds. Null when the field fills its box instead.
   */
  protected readonly frameHeight: Signal<number | null> = computed((): number | null => {
    if (this.fill()) {
      return null;
    }
    const lineHeight: number = this.lineHeight();
    const min: number = this.rowsToPixels(this.minRows(), lineHeight);
    const max: number = Math.max(min, this.rowsToPixels(this.maxRows(), lineHeight));
    const content: number = this.contentHeight() ?? min;
    return Math.min(max, Math.max(min, content));
  });

  /**
   * Constructs the field, wiring the XML check and releasing the editor subscriptions with it.
   */
  public constructor() {
    // XML well-formedness: Monaco has no XML language service, so the field checks the text with the
    // platform parser once typing pauses and files the result as a marker, the way the JSON service
    // does for JSON. Moving to another language clears what was filed.
    effect((): void => {
      const text: string = this.value();
      const language: string = this.language();
      if (!this.editorReady()) {
        return;
      }
      if (this.xmlTimer !== null) {
        clearTimeout(this.xmlTimer);
        this.xmlTimer = null;
      }
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      const model: MonacoApi.editor.ITextModel | null = this.editor().getModel();
      if (monaco === undefined || model === null) {
        return;
      }
      if (language !== 'xml') {
        if (this.xmlMarkersFiled) {
          monaco.editor.setModelMarkers(model, XML_MARKER_OWNER, []);
          this.xmlMarkersFiled = false;
        }
        return;
      }
      this.xmlTimer = setTimeout((): void => {
        this.xmlTimer = null;
        if (model.isDisposed()) {
          return;
        }
        monaco.editor.setModelMarkers(model, XML_MARKER_OWNER, this.xmlMarkersFor(monaco, text));
        this.xmlMarkersFiled = true;
      }, XML_VALIDATE_DEBOUNCE_MS);
    });

    inject(DestroyRef).onDestroy((): void => {
      if (this.xmlTimer !== null) {
        clearTimeout(this.xmlTimer);
        this.xmlTimer = null;
      }
      for (const subscription of this.subscriptions) {
        subscription.dispose();
      }
      this.subscriptions = [];
    });
  }

  /**
   * Handles an edit in the editor, updating the model.
   * @param text The editor's text after the edit.
   */
  protected onChange(text: string): void {
    this.value.set(text);
  }

  /**
   * Handles the editor's creation, following its content height so the frame tracks the text and its
   * markers so the host hears about problems.
   */
  protected onReady(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor().getEditor();
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (editor === null || model === null || monaco === undefined) {
      return;
    }
    const measure: () => void = (): void => {
      this.lineHeight.set(editor.getOption(monaco.editor.EditorOption.lineHeight));
      this.contentHeight.set(editor.getContentHeight());
    };
    const uri: string = model.uri.toString();
    const report: () => void = (): void => {
      if (model.isDisposed()) {
        return;
      }
      this.markersChange.emit(
        monaco.editor
          .getModelMarkers({ resource: model.uri })
          .map((marker: MonacoApi.editor.IMarker): CodeFieldMarker => ({
            severity: this.severityOf(monaco, marker.severity),
            message: marker.message,
            line: marker.startLineNumber,
            column: marker.startColumn,
            source: marker.source ?? '',
          })),
      );
    };
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions = [
      editor.onDidContentSizeChange(measure),
      monaco.editor.onDidChangeMarkers((uris: readonly MonacoApi.Uri[]): void => {
        if (uris.some((changed: MonacoApi.Uri): boolean => changed.toString() === uri)) {
          report();
        }
      }),
    ];
    measure();
    report();
    this.editorReady.set(true);
  }

  /**
   * Builds the XML well-formedness markers for text: one at the first problem, or none.
   * @param monaco The loaded Monaco API.
   * @param text The XML text.
   * @returns Returns the markers to file.
   */
  private xmlMarkersFor(monaco: typeof MonacoApi, text: string): MonacoApi.editor.IMarkerData[] {
    const problem: XmlProblem | null = findXmlProblem(text);
    if (problem === null) {
      return [];
    }
    return [
      {
        severity: monaco.MarkerSeverity.Error,
        message: problem.message,
        source: 'xml',
        startLineNumber: problem.line,
        startColumn: problem.column,
        endLineNumber: problem.line,
        endColumn: problem.column + 1,
      },
    ];
  }

  /**
   * Converts a Monaco marker severity to the field's.
   * @param monaco The loaded Monaco API.
   * @param severity The Monaco severity.
   * @returns Returns the field severity.
   */
  private severityOf(
    monaco: typeof MonacoApi,
    severity: MonacoApi.MarkerSeverity,
  ): CodeFieldMarkerSeverity {
    switch (severity) {
      case monaco.MarkerSeverity.Error:
        return 'error';
      case monaco.MarkerSeverity.Warning:
        return 'warning';
      case monaco.MarkerSeverity.Info:
        return 'info';
      default:
        return 'hint';
    }
  }

  /**
   * Converts a row count to the pixel height of a frame holding that many lines plus the editor's
   * own padding.
   * @param rows The number of rows.
   * @param lineHeight The editor's line height in pixels.
   * @returns Returns the height in pixels.
   */
  private rowsToPixels(rows: number, lineHeight: number): number {
    return Math.max(1, rows) * lineHeight + EDITOR_PADDING_PX * 2;
  }
}
