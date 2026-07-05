import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
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
import { BinaryDisasmPanel } from '../binary-disasm-panel/binary-disasm-panel';
import { BinaryInspector } from '../binary-inspector/binary-inspector';
import { BinaryPanels } from '../binary-panels/binary-panels';
import { BinaryStatus } from '../binary-status/binary-status';

/**
 * Holds the initial width, in pixels, of the disassembly panel.
 */
const DEFAULT_DISASM_SIZE: number = 320;

/**
 * Holds the initial width, in pixels, of the inspector panel.
 */
const DEFAULT_INSPECTOR_SIZE: number = 260;

/**
 * Represents the binary editor's tab view: the shared {@link BinaryEditor} grid in the centre, with
 * toggleable Disassembly and Inspector panels docked to the side via the shared panel layout. It owns
 * the binary-tab concerns the grid does not — resolving the backing document, loading the visible byte
 * window and its disassembly, and the status segment. Read-only for this phase.
 */
@Component({
  selector: 'app-binary-view',
  imports: [PanelLayout, Panel, BinaryEditor, BinaryDisasmPanel, BinaryInspector],
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
   * Holds the byte window the editor last reported visible, used to (re)load disassembly when the
   * format resolves or the viewport moves.
   */
  private readonly visibleRange: WritableSignal<BinaryVisibleRange | null> =
    signal<BinaryVisibleRange | null>(null);

  /**
   * Gets the identifier of the tab this view represents.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether this view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the width, in pixels, of the disassembly panel. Two-way bound to the panel's splitter.
   */
  protected readonly disasmSize: WritableSignal<number> = signal<number>(DEFAULT_DISASM_SIZE);

  /**
   * Holds the width, in pixels, of the inspector panel. Two-way bound to the panel's splitter.
   */
  protected readonly inspectorSize: WritableSignal<number> = signal<number>(DEFAULT_INSPECTOR_SIZE);

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
    // Load disassembly for the visible range (debounced in the document), re-running when the format
    // resolves or the viewport moves.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      const range: BinaryVisibleRange | null = this.visibleRange();
      if (document === undefined || range === null) {
        return;
      }
      document.format();
      document.loadDisassembly(range.offset, range.length);
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
   * Loads the byte window the editor reports visible, and remembers it so disassembly reloads when the
   * format resolves.
   * @param range The visible byte window.
   */
  protected onVisibleRange(range: BinaryVisibleRange): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    this.visibleRange.set(range);
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
}
