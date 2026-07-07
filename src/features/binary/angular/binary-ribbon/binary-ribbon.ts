import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import { BinaryPanels } from '../binary-panels/binary-panels';

/**
 * Represents the contextual ribbon shown when a binary tab is active. Its actions resolve the active
 * binary document from the {@link BinaryDocuments} registry (the ribbon itself takes no inputs) and
 * drive its navigation, byte-copy, and row-width state.
 */
@Component({
  selector: 'app-binary-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripColumn,
    RibbonStripMenuButton,
    RibbonStripField,
  ],
  templateUrl: './binary-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry, used to resolve the active binary tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the binary document registry the ribbon acts on.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Holds the side-panel state the Tools group toggles.
   */
  private readonly binaryPanels: BinaryPanels = inject(BinaryPanels);

  /**
   * Gets the byte-per-row options offered by the layout field.
   */
  protected readonly rowWidths: readonly string[] = ['8', '16', '32', '64'];

  /**
   * Gets the active binary document, or undefined when no binary tab is active.
   */
  protected readonly activeDocument: Signal<BinaryDocumentEntry | undefined> = computed(
    (): BinaryDocumentEntry | undefined => {
      const id: string | undefined = this.tabs.activeTabId();
      return id === undefined ? undefined : this.binaryDocuments.get(id);
    },
  );

  /**
   * Gets the active document's current bytes-per-row as a string, for the layout field.
   */
  protected readonly rowWidthValue: Signal<string> = computed((): string =>
    String(this.activeDocument()?.bytesPerRow() ?? 16),
  );

  /**
   * Gets whether the active document has unsaved edits, enabling the Save action.
   */
  protected readonly dirty: Signal<boolean> = computed(
    (): boolean => this.activeDocument()?.dirty() ?? false,
  );

  /**
   * Gets whether the active document has an edit to undo.
   */
  protected readonly canUndo: Signal<boolean> = computed(
    (): boolean => this.activeDocument()?.canUndo() ?? false,
  );

  /**
   * Gets whether the active document has an undone edit to redo.
   */
  protected readonly canRedo: Signal<boolean> = computed(
    (): boolean => this.activeDocument()?.canRedo() ?? false,
  );

  /**
   * Gets whether the active document is in insert (rather than overwrite) typing mode.
   */
  protected readonly insertMode: Signal<boolean> = computed(
    (): boolean => this.activeDocument()?.insertMode() ?? false,
  );

  /**
   * Saves the active document's edits.
   */
  protected async onSave(): Promise<void> {
    await this.activeDocument()?.save();
  }

  /**
   * Undoes the active document's most recent edit.
   */
  protected onUndo(): void {
    this.activeDocument()?.undo();
  }

  /**
   * Redoes the active document's most recently undone edit.
   */
  protected onRedo(): void {
    this.activeDocument()?.redo();
  }

  /**
   * Toggles the active document between insert and overwrite typing.
   */
  protected onToggleInsertMode(): void {
    const document: BinaryDocumentEntry | undefined = this.activeDocument();
    if (document !== undefined) {
      document.insertMode.set(!document.insertMode());
    }
  }

  /**
   * Gets whether the active document has a known code offset to jump to.
   */
  protected readonly codeAvailable: Signal<boolean> = computed((): boolean => {
    const offset: number | null | undefined = this.activeDocument()?.codeOffset();
    return offset !== null && offset !== undefined;
  });

  /**
   * Gets whether the active document's disassembly panel is currently shown.
   */
  protected readonly disassemblyShown: Signal<boolean> = computed((): boolean => {
    const id: string | undefined = this.tabs.activeTabId();
    return id !== undefined && this.binaryPanels.isVisible(id, 'disassembly');
  });

  /**
   * Gets whether the active document's inspector panel is currently shown.
   */
  protected readonly inspectorShown: Signal<boolean> = computed((): boolean => {
    const id: string | undefined = this.tabs.activeTabId();
    return id !== undefined && this.binaryPanels.isVisible(id, 'inspector');
  });

  /**
   * Toggles the disassembly panel for the active binary tab.
   */
  protected onToggleDisassembly(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.binaryPanels.toggle(id, 'disassembly');
    }
  }

  /**
   * Toggles the inspector panel for the active binary tab.
   */
  protected onToggleInspector(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.binaryPanels.toggle(id, 'inspector');
    }
  }

  /**
   * Gets whether the active document's agent panel is currently shown.
   */
  protected readonly agentShown: Signal<boolean> = computed((): boolean => {
    const id: string | undefined = this.tabs.activeTabId();
    return id !== undefined && this.binaryPanels.isVisible(id, 'agent');
  });

  /**
   * Toggles the agent panel for the active binary tab.
   */
  protected onToggleAgent(): void {
    const id: string | undefined = this.tabs.activeTabId();
    if (id !== undefined) {
      this.binaryPanels.toggle(id, 'agent');
    }
  }

  /**
   * Scrolls to where the file's code begins (entry point or first code section).
   */
  protected onGoToCode(): void {
    const document: BinaryDocumentEntry | undefined = this.activeDocument();
    const offset: number | null | undefined = document?.codeOffset();
    if (document !== undefined && offset !== null && offset !== undefined) {
      document.reveal(offset);
    }
  }

  /**
   * Scrolls to the start of the file.
   */
  protected onGoToStart(): void {
    this.activeDocument()?.reveal(0);
  }

  /**
   * Scrolls to the end of the file.
   */
  protected onGoToEnd(): void {
    const document: BinaryDocumentEntry | undefined = this.activeDocument();
    if (document !== undefined) {
      document.reveal(Math.max(0, document.size() - 1));
    }
  }

  /**
   * Changes how many bytes are shown per row.
   * @param value The chosen bytes-per-row, as a string.
   */
  protected onRowWidthChange(value: string): void {
    const document: BinaryDocumentEntry | undefined = this.activeDocument();
    const parsed: number = Number(value);
    if (document !== undefined && Number.isInteger(parsed) && parsed > 0) {
      document.bytesPerRow.set(parsed);
    }
  }

  /**
   * Gets the Cut dropdown variants: cut as hex (the default) or as ASCII.
   */
  protected readonly cutItems: readonly RibbonMenuItem[] = [
    { id: 'hex', label: 'Cut Hex', icon: Icon.CUT },
    { id: 'ascii', label: 'Cut ASCII', icon: Icon.CUT },
  ];

  /**
   * Gets the Copy dropdown variants: copy as hex (the default) or as ASCII.
   */
  protected readonly copyItems: readonly RibbonMenuItem[] = [
    { id: 'hex', label: 'Copy Hex', icon: Icon.COPY },
    { id: 'ascii', label: 'Copy ASCII', icon: Icon.COPY },
  ];

  /**
   * Copies the selection as hex (the primary Copy action).
   */
  protected async onCopy(): Promise<void> {
    await this.copySelection('hex');
  }

  /**
   * Copies the selection as the chosen Copy dropdown variant.
   * @param id The chosen variant identifier (`hex` or `ascii`).
   */
  protected async onCopyVariant(id: string): Promise<void> {
    await this.copySelection(id === 'ascii' ? 'ascii' : 'hex');
  }

  /**
   * Cuts the selection as hex (the primary Cut action).
   */
  protected async onCut(): Promise<void> {
    await this.cutSelection('hex');
  }

  /**
   * Cuts the selection as the chosen Cut dropdown variant.
   * @param id The chosen variant identifier (`hex` or `ascii`).
   */
  protected async onCutVariant(id: string): Promise<void> {
    await this.cutSelection(id === 'ascii' ? 'ascii' : 'hex');
  }

  /**
   * Copies the selected bytes to the clipboard, formatted as hex pairs or printable ASCII.
   * @param kind Whether to copy the bytes as hex or as ASCII text.
   */
  private async copySelection(kind: 'hex' | 'ascii'): Promise<void> {
    const bytes: number[] = this.activeDocument()?.selectedBytes() ?? [];
    if (bytes.length > 0) {
      await navigator.clipboard.writeText(this.format(bytes, kind));
    }
  }

  /**
   * Cuts the selection: copies it to the clipboard then deletes the selected bytes. Only meaningful in
   * insert mode (deleting shortens the file), so the Cut button is disabled in overwrite mode.
   * @param kind Whether to copy the bytes as hex or as ASCII text.
   */
  private async cutSelection(kind: 'hex' | 'ascii'): Promise<void> {
    const document: BinaryDocumentEntry | undefined = this.activeDocument();
    const selection: BinarySelection | null | undefined = document?.selection();
    if (document === undefined || !document.insertMode() || selection === null || selection === undefined) {
      return;
    }
    await this.copySelection(kind);
    document.deleteBytes(selection.start, selection.end - selection.start);
    document.selection.set(null);
  }

  /**
   * Formats bytes as space-separated hex pairs or as printable ASCII (`.` for non-printable bytes).
   * @param bytes The bytes to format.
   * @param kind The desired format.
   * @returns Returns the formatted string.
   */
  private format(bytes: readonly number[], kind: 'hex' | 'ascii'): string {
    if (kind === 'hex') {
      return bytes.map((byte: number): string => byte.toString(16).padStart(2, '0')).join(' ');
    }
    return bytes
      .map((byte: number): string => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
      .join('');
  }
}
