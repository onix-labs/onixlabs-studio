import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { TabDocks } from '@shared/angular/services/dock-layout/tab-docks';
import { Log } from '@shared/angular/services/log/log';

/**
 * Identifies an openable markdown editor tool panel, which is also its identifier in the tab's dock.
 */
export type OpenableMarkdownPanel = 'outline' | 'review' | 'reader' | 'agent' | 'find';

/**
 * Lists the openable panels, in the order the dock tabs them.
 */
export const OPENABLE_MARKDOWN_PANELS: readonly OpenableMarkdownPanel[] = [
  'outline',
  'review',
  'reader',
  'agent',
  'find',
];

/**
 * Shows and hides the markdown editor's tool panels (Outline, Review, Reader, Agent, Find) in the focused
 * document's dock. Each markdown tab's own dock knows which of them are open.
 *
 * The markdown ribbon's Tools group toggles the panels through this and reads {@link active} to highlight
 * each open one, and Review reads it to know whether it is wanted. The active markdown view records itself
 * through {@link setActiveDocument}.
 */
@Service()
export class MarkdownPanels {
  /**
   * Holds the structured logging client for tool-panel open/close transitions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the tabs' docks.
   */
  private readonly docks: TabDocks = inject(TabDocks);

  /**
   * Holds the id of the focused markdown document's tab, or undefined when none is focused. The ribbon's
   * commands act on this document.
   */
  private readonly activeTabId: WritableSignal<string | undefined> = signal<string | undefined>(
    undefined,
  );

  /**
   * Gets the focused document's open panels. Drives the ribbon's panel highlights and the panels
   * that key off the active editor (such as Review).
   */
  public readonly active: Signal<ReadonlySet<OpenableMarkdownPanel>> = computed(
    (): ReadonlySet<OpenableMarkdownPanel> =>
      new Set<OpenableMarkdownPanel>(
        OPENABLE_MARKDOWN_PANELS.filter((panel: OpenableMarkdownPanel): boolean =>
          this.docks.isOpen(this.activeTabId(), panel),
        ),
      ),
    {
      equal: (
        before: ReadonlySet<OpenableMarkdownPanel>,
        after: ReadonlySet<OpenableMarkdownPanel>,
      ): boolean =>
        before.size === after.size &&
        [...before].every((panel: OpenableMarkdownPanel): boolean => after.has(panel)),
    },
  );

  /**
   * Records the focused markdown document, so the ribbon's no-argument commands act on it.
   * @param id The identifier of the focused document's tab, or undefined when none is focused.
   */
  public setActiveDocument(id: string | undefined): void {
    this.activeTabId.set(id);
  }

  /**
   * Toggles the given panel on the focused document: closes it when it is showing, and otherwise opens it
   * or brings it to the front.
   * @param panel The panel to toggle.
   */
  public toggle(panel: OpenableMarkdownPanel): void {
    this.log.debug('markdown.panels', 'Tool panel toggled', { panel });
    this.docks.toggle(this.activeTabId(), panel);
  }

  /**
   * Opens the given panel on the focused document, alongside any already open.
   * @param panel The panel to open.
   */
  public open(panel: OpenableMarkdownPanel): void {
    this.docks.open(this.activeTabId(), panel);
  }

  /**
   * Closes the given panel on the focused document, leaving its other open panels alone.
   * @param panel The panel to close.
   */
  public close(panel: OpenableMarkdownPanel): void {
    this.docks.close(this.activeTabId(), panel);
  }
}
