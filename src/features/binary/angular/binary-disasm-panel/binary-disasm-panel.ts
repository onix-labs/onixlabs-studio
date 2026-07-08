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
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { Icon } from '@shared/angular/icons/icon';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { ASM_LANGUAGE_ID } from '@shared/angular/services/monaco/monaco-asm-language';
import { DecodedInstruction } from '@shared/api/binary-channels';
import { BinaryDocumentEntry, BinarySelection } from '../binary-document/binary-document';
import { disassemblyArchitecture } from '../binary-format/binary-format';

/**
 * Maps a rendered line back to the instruction it shows, so a click can select its bytes and a byte
 * selection can highlight its line.
 */
interface LineInstruction {
  /**
   * Gets the instruction's first byte offset.
   */
  readonly startOffset: number;

  /**
   * Gets the instruction's length in bytes.
   */
  readonly byteLength: number;
}

/**
 * Holds the built disassembly text and its line-to-instruction map.
 */
interface DisasmContent {
  /**
   * Gets the assembly listing text, one instruction per line.
   */
  readonly text: string;

  /**
   * Gets the per-line instruction map (index `i` is line `i + 1`).
   */
  readonly lines: readonly LineInstruction[];
}

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
  imports: [AppIcon, PanelDragHandle, TextEditor],
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
   * Holds the built listing text and its line-to-instruction map, rebuilt whenever the decoded
   * instructions change (the viewport moved, or the format resolved). Bound to the editor's content.
   */
  protected readonly content: Signal<DisasmContent> = computed(
    (): DisasmContent => buildContent(this.document()?.instructions() ?? []),
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
   * Wires the cross-highlight effect.
   */
  public constructor() {
    // Highlight and reveal the lines whose bytes overlap the current selection. Re-runs when the
    // listing changes (it reads the line map) so the highlight tracks the fresh content.
    effect((): void => {
      this.content();
      const selection: BinarySelection | null = this.document()?.selection() ?? null;
      this.applyHighlight(selection);
    });
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
    );
    this.editorReady.set(true);
    this.applyHighlight(this.document()?.selection() ?? null);
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
    const decorations: MonacoApi.editor.IModelDeltaDecoration[] = [];
    let firstLine: number | null = null;
    this.content().lines.forEach((line: LineInstruction, index: number): void => {
      if (
        line.startOffset < selection.end &&
        line.startOffset + line.byteLength > selection.start
      ) {
        const lineNumber: number = index + 1;
        firstLine ??= lineNumber;
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: { isWholeLine: true, className: 'disasm-line-highlight' },
        });
      }
    });
    this.highlight.set(decorations);
    if (firstLine !== null) {
      editor.revealLineInCenterIfOutsideViewport(firstLine);
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
    const line: LineInstruction | undefined = this.content().lines[lineNumber - 1];
    if (line === undefined) {
      return;
    }
    document.cursor.set(line.startOffset);
    document.selection.set({ start: line.startOffset, end: line.startOffset + line.byteLength });
  }
}

/**
 * Builds the assembly listing text and its line-to-instruction map from the decoded instructions.
 * @param instructions The decoded instructions.
 * @returns Returns the listing text and per-line instruction map.
 */
function buildContent(instructions: readonly DecodedInstruction[]): DisasmContent {
  const rows: string[] = [];
  const lines: LineInstruction[] = [];
  for (const instruction of instructions) {
    const address: string = instruction.startOffset.toString(16).padStart(8, '0').toUpperCase();
    const operands: string = instruction.operands.length > 0 ? ` ${instruction.operands}` : '';
    rows.push(`${address}  ${instruction.mnemonic}${operands}`);
    lines.push({ startOffset: instruction.startOffset, byteLength: instruction.byteLength });
  }
  return { text: rows.join('\n'), lines };
}
