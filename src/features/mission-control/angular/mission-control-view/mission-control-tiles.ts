import { Injectable } from '@angular/core';

/**
 * A view-scoped registry mapping each live agent host id to its rendered tile element, so the agent
 * rail can scroll a column into view. Provided at the {@link import('./mission-control-view').MissionControlView}
 * level: every tile registers its root element on mount and unregisters on destroy, and the rail calls
 * {@link reveal} when its list item is clicked. Scoping it to the view keeps the element references
 * tied to this Mission Control instance and collected with it.
 */
@Injectable()
export class MissionControlTiles {
  /**
   * Holds the registered tile elements, keyed by host id.
   */
  private readonly elements: Map<string, HTMLElement> = new Map<string, HTMLElement>();

  /**
   * Registers a host's tile element, returning a function that unregisters it. A later registration for
   * the same id wins; the unregister is a no-op if the entry has already been replaced.
   * @param id The host id the tile mirrors.
   * @param element The tile's root element.
   * @returns Returns the unregister function.
   */
  public register(id: string, element: HTMLElement): () => void {
    this.elements.set(id, element);
    return (): void => {
      if (this.elements.get(id) === element) {
        this.elements.delete(id);
      }
    };
  }

  /**
   * Scrolls the tile for the given host id into view within the horizontally-scrolling row. A no-op if
   * the tile is not currently mounted.
   * @param id The host id whose tile to reveal.
   */
  public reveal(id: string): void {
    this.elements
      .get(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}
