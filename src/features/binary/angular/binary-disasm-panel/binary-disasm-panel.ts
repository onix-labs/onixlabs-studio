import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { DecoderSupportPrompt } from '@shared/angular/services/plugins/decoder-support-prompt';
import { ASM_LANGUAGE_ID } from '@shared/angular/services/monaco/monaco-asm-language';
import { BinaryDocumentEntry, BinarySelection } from '../binary-document/binary-document';
import {
  buildContent,
  DisasmContent,
  lineForFileOffset,
  LineRow,
  linesForRange,
} from '@shared/angular/services/decoders/listing-content';
import { describeFormat, disassemblyArchitecture, formatKey } from '../binary-format/binary-format';

/**
 * Represents the disassembly side panel: a read-only assembly listing showing the native instructions
 * decoded for the visible byte range, cross-highlighted with the hex grid. It composes the shared
 * {@link TextEditor} pane — pinned to a bare, read-only viewer through its options — and layers the
 * disassembly-specific behaviour on top: clicking a line selects its bytes, and a byte selection
 * highlights (and reveals) the lines it overlaps. It renders the document's already-loaded
 * instructions — the loading itself is driven by the view as the viewport moves.
 */
@Component({
  selector: 'app-binary-disasm-panel',
  imports: [ToolPanel, TextEditor],
  templateUrl: './binary-disasm-panel.html',
  styleUrl: './binary-disasm-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryDisasmPanel implements OnDestroy {
  /**
   * Holds the Monaco service, used to resolve the {@link MonacoApi.Range} constructor when building the
   * cross-highlight decorations.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the structured logger for disassembly-panel interactions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the decoder-install offer, so a format nothing decodes points at the plugin that would.
   */
  private readonly decoderPrompt: DecoderSupportPrompt = inject(DecoderSupportPrompt);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the Monaco language identifier for the assembly listing, exposed for the template's binding.
   */
  protected readonly ASM_LANGUAGE_ID: string = ASM_LANGUAGE_ID;

  /**
   * Gets the document whose instructions are shown, or undefined when none is bound.
   */
  public readonly document: InputSignal<BinaryDocumentEntry | undefined> = input<
    BinaryDocumentEntry | undefined
  >(undefined);

  /**
   * Emits when the panel's close button is pressed.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Pins the composed editor to a bare, read-only assembly viewer: no line numbers (each line already
   * carries its address), no minimap or folding, no current-line highlight, and tight padding. A stable
   * reference so the {@link TextEditor} options input does not churn.
   */
  protected readonly editorOptions: MonacoApi.editor.IEditorOptions = {
    lineNumbers: 'off',
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false,
    lineDecorationsWidth: 0,
    renderLineHighlight: 'none',
    scrollBeyondLastLine: false,
    contextmenu: false,
    wordWrap: 'off',
    padding: { top: 4 },
  };

  /**
   * Holds the composed read-only text-editor pane, or undefined before the view initialises.
   */
  private readonly pane: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Holds whether the document's format can be natively disassembled (drives the empty note overlay).
   */
  protected readonly disassemblable: Signal<boolean> = computed((): boolean => {
    const document: BinaryDocumentEntry | undefined = this.document();
    return document !== undefined && disassemblyArchitecture(document.format()) !== null;
  });

  /**
   * Holds what to say when there is no listing to show.
   *
   * Three different situations read identically as an empty pane, and telling them apart is the whole
   * point: nothing recognises the file, something could decode it but is not installed, or a decoder is
   * installed and simply has not decoded this range yet.
   */
  protected readonly emptyNote: Signal<string | null> = computed((): string | null => {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return null;
    }
    // A format the in-core disassembler handles says nothing while it has not decoded yet: an empty
    // listing there means "not decoded", not "cannot decode", and reporting the latter would flicker a
    // wrong message every time the viewport moves.
    if (this.disassemblable()) {
      return null;
    }
    const key: string | null = formatKey(document.format());
    if (key === null) {
      return 'No listing available for this format.';
    }
    const description: string = describeFormat(document.format());
    if (this.decoderPrompt.isCovered(key)) {
      return null;
    }
    return this.decoderPrompt.isOffered(key)
      ? `No decoder installed for ${description}.`
      : `No decoder available for ${description}.`;
  });

  /**
   * Holds the built listing text and its line-to-instruction map, rebuilt whenever the decoded
   * instructions change (the viewport moved, or the format resolved). Bound to the editor's content.
   */
  protected readonly content: Signal<DisasmContent> = computed((): DisasmContent =>
    buildContent(this.document()?.listing() ?? null),
  );

  /**
   * Holds the selection-highlight decorations, or null before the editor is ready.
   */
  private highlight: MonacoApi.editor.IEditorDecorationsCollection | null = null;

  /**
   * Holds whether the composed editor has been created and is ready for decorations.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the editor-instance listeners to release when the panel is torn down.
   */
  private readonly disposables: MonacoApi.IDisposable[] = [];

  /**
   * Holds the last reveal request (the document's reveal version) this panel has scrolled to, so a
   * given jump-to-offset is honoured exactly once rather than fighting the user's later scrolling.
   */
  private lastRevealedVersion: number = -1;

  /**
   * Holds the one-based line a pending jump-to-offset should centre, or null when none is pending. The
   * scroll is deferred to {@link flushPendingReveal} so it runs only once the freshly-shown editor has
   * real dimensions — a reveal on a zero-height editor is silently dropped.
   */
  private pendingRevealLine: number | null = null;

  /**
   * Wires the cross-highlight and jump-to-offset effects.
   */
  public constructor() {
    // Highlight and reveal the lines whose bytes overlap the current selection. Re-runs when the
    // listing changes (it reads the line map) so the highlight tracks the fresh content.
    effect((): void => {
      this.content();
      const selection: BinarySelection | null = this.document()?.selection() ?? null;
      this.applyHighlight(selection);
    });

    // Offer the decoder install at the moment it is missed, rather than leaving an empty pane with no
    // hint that anything exists. Asks once per format per session.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined || this.disassemblable()) {
        return;
      }
      const key: string | null = formatKey(document.format());
      if (key !== null) {
        this.decoderPrompt.offerFor(key, describeFormat(document.format()));
      }
    });

    // Queue a scroll to a requested offset (the entry-point jump on open, or a go-to-offset) once its
    // instruction is present in the listing. Re-runs when the listing changes so a reveal made before
    // the target byte was decoded is honoured the moment the instruction arrives; the version guard
    // scrolls each request once, so it does not override where the user later scrolls to.
    effect((): void => {
      const content: DisasmContent = this.content();
      const document: BinaryDocumentEntry | undefined = this.document();
      const version: number = document?.revealVersion() ?? 0;
      const offset: number | null = document?.revealOffset ?? null;
      if (offset === null || version === this.lastRevealedVersion) {
        return;
      }
      const line: number | null = lineForFileOffset(content, offset);
      if (line === null) {
        return;
      }
      this.lastRevealedVersion = version;
      this.pendingRevealLine = line;
      this.flushPendingReveal();
    });
  }

  /**
   * Scrolls a pending jump-to-offset line to the centre, but only once the editor has laid out with a
   * real height — otherwise the reveal is a no-op, so the request is left pending for the next layout.
   */
  private flushPendingReveal(): void {
    const line: number | null = this.pendingRevealLine;
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.pane()?.getEditor() ?? null;
    if (
      line === null ||
      editor === null ||
      !this.editorReady() ||
      editor.getLayoutInfo().height <= 0
    ) {
      return;
    }
    editor.revealLineInCenter(line);
    this.pendingRevealLine = null;
  }

  /**
   * Releases the editor-instance listeners when the panel is torn down. The composed pane disposes the
   * Monaco editor (and with it the decorations) itself.
   */
  public ngOnDestroy(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.highlight = null;
    this.editorReady.set(false);
  }

  /**
   * Emits the close request so the host hides the panel.
   */
  protected onClose(): void {
    this.log.info('binary.disassembly', 'Disassembly panel closed');
    this.closed.emit();
  }

  /**
   * Wires the editor-instance features once the composed pane's Monaco editor exists: the selection
   * decorations, the click-to-select-bytes handler, and a re-highlight after each content change. The
   * pane's `setValue` clears all decorations, so they must be re-applied once it has run — hence the
   * re-highlight on the model-content change rather than only in the content effect.
   */
  protected onReady(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.pane()?.getEditor() ?? null;
    if (editor === null) {
      return;
    }
    this.highlight = editor.createDecorationsCollection();
    this.disposables.push(
      editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onEditorMouseDown(event),
      ),
      editor.onDidChangeModelContent((): void =>
        this.applyHighlight(this.document()?.selection() ?? null),
      ),
      // A jump-to-offset queued before the panel had a size (e.g. the entry-point reveal that runs as
      // the panel is toggled on) lands the moment the editor lays out with a real height.
      editor.onDidLayoutChange((): void => this.flushPendingReveal()),
    );
    this.editorReady.set(true);
    this.applyHighlight(this.document()?.selection() ?? null);
    this.flushPendingReveal();
  }

  /**
   * Highlights and reveals the lines whose instruction bytes overlap the selection.
   * @param selection The current byte selection, or null when nothing is selected.
   */
  private applyHighlight(selection: BinarySelection | null): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.pane()?.getEditor() ?? null;
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (editor === null || monaco === undefined || this.highlight === null || !this.editorReady()) {
      return;
    }
    if (selection === null) {
      this.highlight.clear();
      return;
    }
    // Rows with no file offset — JIT output, whose bytes are in no file — never match, which is the
    // correct outcome rather than a gap: there is nothing on disk for the selection to correspond to.
    const overlapping: readonly number[] = linesForRange(
      this.content(),
      selection.start,
      selection.end,
    );
    const decorations: MonacoApi.editor.IModelDeltaDecoration[] = overlapping.map(
      (lineNumber: number): MonacoApi.editor.IModelDeltaDecoration => ({
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: { isWholeLine: true, className: 'disasm-line-highlight' },
      }),
    );
    this.highlight.set(decorations);
    if (overlapping.length > 0) {
      editor.revealLineInCenterIfOutsideViewport(overlapping[0]);
    }
  }

  /**
   * Selects the clicked line's instruction bytes, so the hex and ASCII columns highlight the bytes it
   * decodes from.
   * @param event The Monaco mouse-down event.
   */
  private onEditorMouseDown(event: MonacoApi.editor.IEditorMouseEvent): void {
    const lineNumber: number | undefined = event.target.position?.lineNumber;
    const document: BinaryDocumentEntry | undefined = this.document();
    if (lineNumber === undefined || document === undefined) {
      return;
    }
    // A section heading or note occupies a line but shows no row, so clicking one selects nothing
    // rather than selecting whatever row happened to be at that index.
    const line: LineRow | null | undefined = this.content().lines[lineNumber - 1];
    if (line?.fileOffset === undefined || line.fileOffset === null) {
      return;
    }
    const start: number = line.fileOffset;
    this.log.debug('binary.disassembly', `Instruction line selected at 0x${start.toString(16)}`);
    document.cursor.set(start);
    document.selection.set({ start, end: start + Math.max(line.byteLength, 1) });
  }
}
