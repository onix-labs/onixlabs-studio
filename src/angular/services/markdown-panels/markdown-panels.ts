import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies a markdown editor tool panel, or `none` when no panel is open.
 */
export type MarkdownPanel = 'none' | 'outline' | 'review' | 'agent' | 'reader';

/**
 * Identifies an openable markdown editor tool panel (every {@link MarkdownPanel} except `none`).
 */
export type OpenableMarkdownPanel = Exclude<MarkdownPanel, 'none'>;

/**
 * Tracks which markdown editor tool panel (Outline, Review, Agent, or Reader) is open, per document.
 *
 * Each markdown tab remembers its own open panel, so switching tabs does not tear down (and lose the
 * conversation in) another tab's Agent panel. The markdown ribbon's Tools group toggles the active
 * document's panel through this registry and reads {@link active} to highlight it; each markdown view
 * reads {@link activeFor} to decide which panel to show beside its own editor. The active markdown
 * view records itself through {@link setActiveDocument} so the ribbon's no-argument commands act on
 * the focused editor.
 */
@Service()
export class MarkdownPanels {
  /**
   * Holds the open panel for every markdown document, keyed by document id.
   */
  private readonly states: WritableSignal<ReadonlyMap<string, MarkdownPanel>> = signal<
    ReadonlyMap<string, MarkdownPanel>
  >(new Map<string, MarkdownPanel>());

  /**
   * Holds the id of the focused markdown document, or null when none is focused. The ribbon's
   * commands act on this document.
   */
  private readonly activeDocId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the focused document's open panel, or `none`. Drives the ribbon's panel highlight and the
   * panels that key off the active editor (such as Review).
   */
  public readonly active: Signal<MarkdownPanel> = computed(
    (): MarkdownPanel => this.activeFor(this.activeDocId() ?? ''),
  );

  /**
   * Gets the open panel for a specific document.
   * @param id The document identifier.
   * @returns Returns the document's open panel, or `none`.
   */
  public activeFor(id: string): MarkdownPanel {
    return this.states().get(id) ?? 'none';
  }

  /**
   * Records the focused markdown document, so the ribbon's no-argument commands act on it.
   * @param id The focused document's id, or null when none is focused.
   */
  public setActiveDocument(id: string | null): void {
    this.activeDocId.set(id);
  }

  /**
   * Toggles the given panel on the focused document: opens it when it is not that document's active
   * panel, or closes it when it is.
   * @param panel The panel to toggle.
   */
  public toggle(panel: OpenableMarkdownPanel): void {
    const id: string | null = this.activeDocId();
    if (id !== null) {
      this.set(id, this.activeFor(id) === panel ? 'none' : panel);
    }
  }

  /**
   * Opens the given panel on the focused document.
   * @param panel The panel to open.
   */
  public open(panel: OpenableMarkdownPanel): void {
    const id: string | null = this.activeDocId();
    if (id !== null) {
      this.set(id, panel);
    }
  }

  /**
   * Closes the focused document's open panel, if any.
   */
  public close(): void {
    const id: string | null = this.activeDocId();
    if (id !== null) {
      this.set(id, 'none');
    }
  }

  /**
   * Forgets a document's panel state. Called when its tab closes.
   * @param id The document identifier.
   */
  public remove(id: string): void {
    const next: Map<string, MarkdownPanel> = new Map<string, MarkdownPanel>(this.states());
    if (next.delete(id)) {
      this.states.set(next);
    }
  }

  /**
   * Sets a document's open panel.
   * @param id The document identifier.
   * @param panel The panel to set.
   */
  private set(id: string, panel: MarkdownPanel): void {
    const next: Map<string, MarkdownPanel> = new Map<string, MarkdownPanel>(this.states());
    next.set(id, panel);
    this.states.set(next);
  }
}
