import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { BinaryDocumentEntry, BinaryDocuments } from '../binary-document/binary-document';
import { BinaryPanels } from '../binary-panels/binary-panels';

/**
 * Represents the contextual ribbon shown when a binary tab is active. Its actions resolve the active
 * binary document from the {@link BinaryDocuments} registry (the ribbon itself takes no inputs) and
 * drive its navigation, byte-copy, and row-width state.
 */
@Component({
  selector: 'app-binary-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton, RibbonStripField],
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
   * Copies the selected bytes to the clipboard as space-separated hex pairs.
   */
  protected async onCopyHex(): Promise<void> {
    const bytes: number[] = this.activeDocument()?.selectedBytes() ?? [];
    if (bytes.length > 0) {
      await navigator.clipboard.writeText(
        bytes.map((byte: number): string => byte.toString(16).padStart(2, '0')).join(' '),
      );
    }
  }

  /**
   * Copies the selected bytes to the clipboard as printable text (`.` for non-printable bytes).
   */
  protected async onCopyText(): Promise<void> {
    const bytes: number[] = this.activeDocument()?.selectedBytes() ?? [];
    if (bytes.length > 0) {
      await navigator.clipboard.writeText(
        bytes
          .map((byte: number): string =>
            byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.',
          )
          .join(''),
      );
    }
  }
}
