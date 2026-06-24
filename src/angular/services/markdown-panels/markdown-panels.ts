import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies a markdown editor tool panel, or `none` when no panel is open.
 */
export type MarkdownPanel = 'none' | 'outline' | 'review' | 'agent' | 'reader';

/**
 * Identifies an openable markdown editor tool panel (every {@link MarkdownPanel} except `none`).
 */
export type OpenableMarkdownPanel = Exclude<MarkdownPanel, 'none'>;

/**
 * Tracks which markdown editor tool panel (Outline, Review, Agent, or Reader) is currently open.
 *
 * The markdown ribbon's Tools group toggles panels through this registry, and the active markdown
 * view reads {@link active} to decide which panel to show beside the editor. A single panel is open
 * at a time, shared across markdown tabs.
 */
@Service()
export class MarkdownPanels {
  /**
   * Holds the backing state for {@link active}.
   */
  private readonly activeState: WritableSignal<MarkdownPanel> = signal<MarkdownPanel>('none');

  /**
   * Gets the currently open tool panel, or `none` when none is open.
   */
  public readonly active: Signal<MarkdownPanel> = this.activeState.asReadonly();

  /**
   * Toggles the given panel: opens it when it is not the active panel, or closes it when it is.
   * @param panel The panel to toggle.
   */
  public toggle(panel: OpenableMarkdownPanel): void {
    this.activeState.update((current: MarkdownPanel): MarkdownPanel =>
      current === panel ? 'none' : panel,
    );
  }

  /**
   * Opens the given panel.
   * @param panel The panel to open.
   */
  public open(panel: OpenableMarkdownPanel): void {
    this.activeState.set(panel);
  }

  /**
   * Closes the open panel, if any.
   */
  public close(): void {
    this.activeState.set('none');
  }
}
