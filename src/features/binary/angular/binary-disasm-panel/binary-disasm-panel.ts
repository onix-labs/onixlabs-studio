import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
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
 * Represents the disassembly side panel: a read-only Monaco editor showing the native instructions
 * decoded for the visible byte range as syntax-highlighted assembly, cross-highlighted with the hex
 * grid. Clicking a line selects its bytes; a byte selection highlights (and reveals) the lines it
 * overlaps. It renders the document's already-loaded instructions — the loading itself is driven by
 * the view as the viewport moves.
 */
@Component({
  selector: 'app-binary-disasm-panel',
  imports: [AppIcon],
  templateUrl: './binary-disasm-panel.html',
  styleUrl: './binary-disasm-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryDisasmPanel implements AfterViewInit, OnDestroy {
  /**
   * Holds the Monaco service used to load the engine and resolve options.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
   * Holds the element the Monaco editor mounts into.
   */
  private readonly host: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('host');

  /**
   * Holds whether the document's format can be natively disassembled (drives the empty note overlay).
   */
  protected readonly disassemblable: Signal<boolean> = computed((): boolean => {
    const document: BinaryDocumentEntry | undefined = this.document();
    return document !== undefined && disassemblyArchitecture(document.format()) !== null;
  });

  /**
   * Holds the per-line instruction map for the current content, kept as a signal so the highlight
   * re-applies after a content rebuild.
   */
  private readonly lineInstructions: WritableSignal<readonly LineInstruction[]> = signal<
    readonly LineInstruction[]
  >([]);

  /**
   * Holds the Monaco editor instance, or null before creation and after disposal.
   */
  private editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  /**
   * Holds the selection-highlight decorations, or null before the editor is created.
   */
  private highlight: MonacoApi.editor.IEditorDecorationsCollection | null = null;

  /**
   * Holds whether the editor has been created and is ready for content and decorations.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Wires the content-rebuild and cross-highlight effects.
   */
  public constructor() {
    // Rebuild the listing whenever the decoded instructions change (the viewport moved, or the format
    // resolved).
    effect((): void => {
      const instructions: readonly DecodedInstruction[] = this.document()?.instructions() ?? [];
      this.rebuild(instructions);
    });

    // Highlight and reveal the lines whose bytes overlap the current selection. Re-runs after a
    // rebuild (it reads the line map) so the highlight tracks the fresh content.
    effect((): void => {
      this.lineInstructions();
      const selection: BinarySelection | null = this.document()?.selection() ?? null;
      this.applyHighlight(selection);
    });
  }

  /**
   * Loads Monaco if needed and creates the editor once the host element is available.
   */
  public ngAfterViewInit(): void {
    void this.initEditor();
  }

  /**
   * Disposes the editor when the panel is torn down.
   */
  public ngOnDestroy(): void {
    if (this.editor !== null) {
      this.editor.dispose();
      this.editor = null;
    }
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
   * Awaits the Monaco load, then creates the read-only assembly editor.
   * @returns Returns a promise that resolves once the editor has been created.
   */
  private async initEditor(): Promise<void> {
    await this.monaco.ensureLoaded();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return;
    }
    const content: DisasmContent = buildContent(this.document()?.instructions() ?? []);
    this.editor = monaco.editor.create(this.host().nativeElement, {
      ...this.monaco.getEditorOptions(ASM_LANGUAGE_ID),
      value: content.text,
      language: ASM_LANGUAGE_ID,
      readOnly: true,
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
    });
    this.lineInstructions.set(content.lines);
    this.highlight = this.editor.createDecorationsCollection();
    this.editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void =>
      this.onEditorMouseDown(event),
    );
    this.editorReady.set(true);
    this.applyHighlight(this.document()?.selection() ?? null);
  }

  /**
   * Rebuilds the listing text and line map, replacing the editor's content when it differs.
   * @param instructions The decoded instructions to render.
   */
  private rebuild(instructions: readonly DecodedInstruction[]): void {
    const content: DisasmContent = buildContent(instructions);
    this.lineInstructions.set(content.lines);
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null || !this.editorReady()) {
      return;
    }
    if (editor.getValue() !== content.text) {
      editor.setValue(content.text);
    }
  }

  /**
   * Highlights and reveals the lines whose instruction bytes overlap the selection.
   * @param selection The current byte selection, or null when nothing is selected.
   */
  private applyHighlight(selection: BinarySelection | null): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
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
    this.lineInstructions().forEach((line: LineInstruction, index: number): void => {
      if (line.startOffset < selection.end && line.startOffset + line.byteLength > selection.start) {
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
    const line: LineInstruction | undefined = this.lineInstructions()[lineNumber - 1];
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
