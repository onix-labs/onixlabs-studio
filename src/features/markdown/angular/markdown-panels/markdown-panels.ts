import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies an openable markdown editor tool panel. Several can be open beside one editor at once,
 * so a document's open panels are tracked as a set rather than a single active panel.
 */
export type OpenableMarkdownPanel = 'outline' | 'review' | 'agent' | 'reader' | 'find';

/**
 * The shared empty set returned for a document with no open panels, so callers get a stable
 * reference (and change detection sees no change) until something actually opens.
 */
const NO_PANELS: ReadonlySet<OpenableMarkdownPanel> = new Set<OpenableMarkdownPanel>();

/**
 * Tracks which markdown editor tool panels (Outline, Review, Agent, Reader, Find) are open, per
 * document. More than one can be open at a time; they tile side by side in the shared panel layout.
 *
 * Each markdown tab remembers its own open panels, so switching tabs does not tear down (and lose
 * the conversation in) another tab's Agent panel. The markdown ribbon's Tools group toggles the
 * active document's panels through this registry and reads {@link active} to highlight each open
 * one; each markdown view reads {@link openFor} to decide which panels to show beside its own
 * editor. The active markdown view records itself through {@link setActiveDocument} so the ribbon's
 * no-argument commands act on the focused editor.
 */
@Service()
export class MarkdownPanels {
  /**
   * Holds the set of open panels for every markdown document, keyed by document id.
   */
  private readonly states: WritableSignal<
    ReadonlyMap<string, ReadonlySet<OpenableMarkdownPanel>>
  > = signal<ReadonlyMap<string, ReadonlySet<OpenableMarkdownPanel>>>(
    new Map<string, ReadonlySet<OpenableMarkdownPanel>>(),
  );

  /**
   * Holds the id of the focused markdown document, or null when none is focused. The ribbon's
   * commands act on this document.
   */
  private readonly activeDocId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the focused document's open panels. Drives the ribbon's panel highlights and the panels
   * that key off the active editor (such as Review).
   */
  public readonly active: Signal<ReadonlySet<OpenableMarkdownPanel>> = computed(
    (): ReadonlySet<OpenableMarkdownPanel> => this.openFor(this.activeDocId() ?? ''),
  );

  /**
   * Gets the open panels for a specific document.
   * @param id The document identifier.
   * @returns Returns the document's open panels, or an empty set.
   */
  public openFor(id: string): ReadonlySet<OpenableMarkdownPanel> {
    return this.states().get(id) ?? NO_PANELS;
  }

  /**
   * Records the focused markdown document, so the ribbon's no-argument commands act on it.
   * @param id The focused document's id, or null when none is focused.
   */
  public setActiveDocument(id: string | null): void {
    this.activeDocId.set(id);
  }

  /**
   * Toggles the given panel on the focused document: opens it when closed, closes it when open,
   * leaving the document's other open panels alone.
   * @param panel The panel to toggle.
   */
  public toggle(panel: OpenableMarkdownPanel): void {
    const id: string | null = this.activeDocId();
    if (id === null) {
      return;
    }
    const next: Set<OpenableMarkdownPanel> = new Set<OpenableMarkdownPanel>(this.openFor(id));
    if (next.has(panel)) {
      next.delete(panel);
    } else {
      next.add(panel);
    }
    this.set(id, next);
  }

  /**
   * Opens the given panel on the focused document, alongside any already open.
   * @param panel The panel to open.
   */
  public open(panel: OpenableMarkdownPanel): void {
    const id: string | null = this.activeDocId();
    if (id === null) {
      return;
    }
    const next: Set<OpenableMarkdownPanel> = new Set<OpenableMarkdownPanel>(this.openFor(id));
    next.add(panel);
    this.set(id, next);
  }

  /**
   * Closes the given panel on the focused document, leaving its other open panels alone.
   * @param panel The panel to close.
   */
  public close(panel: OpenableMarkdownPanel): void {
    const id: string | null = this.activeDocId();
    if (id === null) {
      return;
    }
    const next: Set<OpenableMarkdownPanel> = new Set<OpenableMarkdownPanel>(this.openFor(id));
    if (next.delete(panel)) {
      this.set(id, next);
    }
  }

  /**
   * Forgets a document's open panels. Called when its tab closes.
   * @param id The document identifier.
   */
  public remove(id: string): void {
    const next: Map<string, ReadonlySet<OpenableMarkdownPanel>> = new Map<
      string,
      ReadonlySet<OpenableMarkdownPanel>
    >(this.states());
    if (next.delete(id)) {
      this.states.set(next);
    }
  }

  /**
   * Sets a document's open panels.
   * @param id The document identifier.
   * @param panels The document's open panels.
   */
  private set(id: string, panels: ReadonlySet<OpenableMarkdownPanel>): void {
    const next: Map<string, ReadonlySet<OpenableMarkdownPanel>> = new Map<
      string,
      ReadonlySet<OpenableMarkdownPanel>
    >(this.states());
    next.set(id, panels);
    this.states.set(next);
  }
}
