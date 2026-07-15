import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
} from '@angular/core';
import {
  BinaryEditOp,
  BinaryEditor,
  BinaryRange,
  BinaryVisibleRange,
} from '@shared/angular/components/binary-editor/binary-editor';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import { describeFormat } from '../binary-format/binary-format';
import { BinaryAgentPanel } from './binary-agent-panel/binary-agent-panel';
import { BinaryDisasmPanel } from '../binary-disasm-panel/binary-disasm-panel';
import { BinaryInspector } from '../binary-inspector/binary-inspector';
import { BinaryPanels } from '../binary-panels/binary-panels';
import { BinaryStatus } from '../binary-status/binary-status';

/**
 * The number of bytes decoded before the focus offset in the disassembly window, giving the listing a
 * little context above the focused instruction.
 */
const DISASM_WINDOW_LEAD: number = 256;

/**
 * The length, in bytes, of the disassembly window decoded around the focus offset. Bounded so the
 * listing stays a screenful — a focus deep inside a multi-gigabyte file decodes only its neighbourhood
 * rather than everything from the file start.
 */
const DISASM_WINDOW_SPAN: number = 2048;

/**
 * A decoded byte window: its start offset and length.
 */
interface DisasmWindow {
  /**
   * Gets the window's start offset.
   */
  readonly offset: number;

  /**
   * Gets the window's length in bytes.
   */
  readonly length: number;
}

/**
 * Represents the binary editor's tab view: the shared {@link BinaryEditor} grid in the centre, with
 * toggleable Disassembly, Inspector and Agent panels docked around it via the shared panel layout —
 * where each panel lives is the user's choice, dragged and persisted per view type. It owns the
 * binary-tab concerns the grid does not — resolving the backing document, loading the visible byte
 * window and its disassembly, and the status segment. Read-only for this phase.
 */
@Component({
  selector: 'app-binary-view',
  imports: [PanelLayout, Panel, BinaryEditor, BinaryDisasmPanel, BinaryInspector, BinaryAgentPanel],
  templateUrl: './binary-view.html',
  styleUrl: './binary-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryView implements OnDestroy {
  /**
   * Holds the binary document registry the view resolves its document from.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Holds the status service the active view publishes its cursor/selection/size to.
   */
  private readonly binaryStatus: BinaryStatus = inject(BinaryStatus);

  /**
   * Holds the side-panel state (which of the Disassembly/Inspector panels are shown).
   */
  private readonly binaryPanels: BinaryPanels = inject(BinaryPanels);

  /**
   * Holds the byte window currently decoded into the disassembly listing, or null before the first
   * window is cut. The window follows the focus (cursor), not the hex viewport, and is re-cut only when
   * the focus leaves it — so the disassembly panel owns where it looks and does not churn as the cursor
   * moves within the shown code.
   */
  private disasmWindow: DisasmWindow | null = null;

  /**
   * Gets the identifier of the tab this view represents.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether this view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the resolved binary document, or undefined when the tab has none.
   */
  protected readonly document: Signal<BinaryDocumentEntry | undefined> = computed(
    (): BinaryDocumentEntry | undefined => this.binaryDocuments.get(this.tabId()),
  );

  /**
   * Gets the random-access byte accessor handed to the editor, reading the document's block cache.
   */
  protected readonly byteAt: (offset: number) => number | null = (offset: number): number | null =>
    this.document()?.byteAt(offset) ?? null;

  /**
   * Initializes the view: loads disassembly for the visible range and publishes status while active.
   */
  public constructor() {
    // Decode a bounded window of instructions around the focus — the cursor, which the entry-point jump
    // on open, the go-to-offset action, and clicking a byte or a disassembly line all set. The panel
    // owns where it looks rather than mirroring the hex viewport's scroll, so the entry jump reliably
    // decodes and centres the code. Re-runs when the format resolves and when freshly-loaded bytes
    // arrive (so a window awaiting its bytes decodes once they land); the window is re-cut only when the
    // focus leaves it, and loadDisassembly caches by range, so this settles to a cache hit.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return;
      }
      document.format();
      document.loadedVersion();
      const focus: number = document.cursor() ?? 0;
      let active: DisasmWindow | null = this.disasmWindow;
      if (active === null || focus < active.offset || focus >= active.offset + active.length) {
        const offset: number = Math.max(0, focus - DISASM_WINDOW_LEAD);
        active = { offset, length: DISASM_WINDOW_SPAN };
        this.disasmWindow = active;
        document.ensureRange(offset, DISASM_WINDOW_SPAN);
      }
      document.loadDisassembly(active.offset, active.length);
    });

    // Publish this view's context to the status strip while it is the active tab.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (this.isActive() && document !== undefined) {
        const selection: BinarySelection | null = document.selection();
        this.binaryStatus.publish(this.tabId(), {
          path: document.path,
          offset: document.cursor(),
          selectionLength: selection === null ? 0 : selection.end - selection.start,
          size: document.size(),
          format: describeFormat(document.format()),
          dirty: document.dirty(),
          insertMode: document.insertMode(),
        });
      } else {
        this.binaryStatus.clear(this.tabId());
      }
    });
  }

  /**
   * Clears this view's status contribution and panel state when the tab closes.
   */
  public ngOnDestroy(): void {
    this.binaryStatus.clear(this.tabId());
    this.binaryPanels.remove(this.tabId());
    this.binaryDocuments.release(this.tabId());
  }

  /**
   * Gets whether the disassembly panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected disasmMounted(): boolean {
    return this.binaryPanels.isMounted(this.tabId(), 'disassembly');
  }

  /**
   * Gets whether the disassembly panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected disasmVisible(): boolean {
    return this.binaryPanels.isVisible(this.tabId(), 'disassembly');
  }

  /**
   * Gets whether the inspector panel is mounted.
   * @returns Returns true when the panel has been shown at least once.
   */
  protected inspectorMounted(): boolean {
    return this.binaryPanels.isMounted(this.tabId(), 'inspector');
  }

  /**
   * Gets whether the inspector panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected inspectorVisible(): boolean {
    return this.binaryPanels.isVisible(this.tabId(), 'inspector');
  }

  /**
   * Hides the disassembly panel when it asks to close.
   */
  protected onHideDisasm(): void {
    this.binaryPanels.hide(this.tabId(), 'disassembly');
  }

  /**
   * Hides the inspector panel when it asks to close.
   */
  protected onHideInspector(): void {
    this.binaryPanels.hide(this.tabId(), 'inspector');
  }

  /**
   * Gets whether the agent panel is currently visible.
   * @returns Returns true when the panel is shown.
   */
  protected agentVisible(): boolean {
    return this.binaryPanels.isVisible(this.tabId(), 'agent');
  }

  /**
   * Loads the byte window the editor reports visible, and remembers it so disassembly reloads when the
   * format resolves.
   * @param range The visible byte window.
   */
  protected onVisibleRange(range: BinaryVisibleRange): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    document.ensureRange(range.offset, range.length);
  }

  /**
   * Records the selection reported by the editor onto the document, so the disassembly and inspector
   * cross-highlight follows it.
   * @param range The new selection.
   */
  protected onSelectionChange(range: BinaryRange): void {
    this.document()?.selection.set({ start: range.start, end: range.end });
  }

  /**
   * Records the cursor reported by the editor onto the document.
   * @param offset The cursor's byte offset.
   */
  protected onCursorChange(offset: number): void {
    this.document()?.cursor.set(offset);
  }

  /**
   * Snaps the selection to the whole instruction containing a double-clicked byte, so a double-click
   * selects an instruction. Falls back to the single byte when no instruction covers the offset.
   * @param offset The double-clicked byte offset.
   */
  protected onUnitSelect(offset: number): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    const range: BinarySelection | null = document.instructionRangeAt(offset);
    if (range !== null) {
      document.selection.set(range);
      document.cursor.set(range.start);
    }
  }

  /**
   * Applies a typed edit — overwrite, insert, or delete — to the document.
   * @param op The edit reported by the editor.
   */
  protected onOp(op: BinaryEditOp): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    switch (op.kind) {
      case 'overwrite':
        document.overwrite(op.offset, op.value);
        break;
      case 'insert':
        document.insertByte(op.offset, op.value);
        break;
      case 'delete':
        document.deleteBytes(op.offset, op.count);
        break;
    }
  }
}
