import { inject, Injectable } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { TileScrollMode } from '@shared/angular/services/settings/settings-registry';

/**
 * A view-scoped registry mapping each live agent host id to its rendered tile element, so the agent
 * rail can scroll a column into view. Provided at the {@link import('./mission-control-view').MissionControlView}
 * level: every tile registers its root element on mount and unregisters on destroy, the view registers
 * the scrolling row and its trailing spacer, and the rail calls {@link reveal} when a list item is
 * clicked. Scoping it to the view keeps the element references tied to this Mission Control instance and
 * collected with it.
 *
 * The scroll behaviour follows the `missionControl.tileScrollMode` setting: `into-view` performs the
 * minimal scroll to reveal the column; `absolute-left` aligns the column's leading edge to the start of
 * the row (immediately after the panel). In `absolute-left` mode the trailing spacer is grown just
 * enough that even the last columns can reach the leading edge — leaving the empty space at the end that
 * left-alignment implies.
 */
@Injectable()
export class MissionControlTiles {
  /**
   * Holds the settings service the scroll mode is read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the registered tile elements, keyed by host id.
   */
  private readonly elements: Map<string, HTMLElement> = new Map<string, HTMLElement>();

  /**
   * Holds the scrolling row element, or null before the view registers it.
   */
  private row: HTMLElement | null = null;

  /**
   * Holds the row's trailing spacer element, sized to allow left-alignment of the last columns.
   */
  private spacer: HTMLElement | null = null;

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
   * Registers the scrolling row and its trailing spacer, returning a function that clears them.
   * @param row The horizontally-scrolling row element.
   * @param spacer The row's trailing spacer element.
   * @returns Returns the clear function.
   */
  public setRow(row: HTMLElement, spacer: HTMLElement): () => void {
    this.row = row;
    this.spacer = spacer;
    this.refreshSpacer();
    return (): void => {
      if (this.row === row) {
        this.row = null;
        this.spacer = null;
      }
    };
  }

  /**
   * Scrolls the tile for the given host id into view within the row, following the configured scroll
   * mode. A no-op if the tile is not currently mounted.
   * @param id The host id whose tile to reveal.
   */
  public reveal(id: string): void {
    const element: HTMLElement | undefined = this.elements.get(id);
    if (element === undefined) {
      return;
    }
    if (this.scrollMode() !== 'absolute-left' || this.row === null) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      return;
    }
    // Size the spacer first so the row can scroll far enough to bring even the last column to the
    // leading edge, then align this column's left edge to the row's left edge.
    this.refreshSpacer();
    const delta: number =
      element.getBoundingClientRect().left - this.row.getBoundingClientRect().left;
    this.row.scrollBy({ left: delta, behavior: 'smooth' });
  }

  /**
   * Re-sizes the trailing spacer for the current scroll mode and layout. In `absolute-left` mode, when
   * the columns overflow the row, the spacer takes the width the row has beyond the last column so that
   * column can be scrolled to the leading edge; otherwise it collapses to nothing. Safe to call
   * whenever the mode, the agent set, or the row's size changes.
   */
  public refreshSpacer(): void {
    const spacer: HTMLElement | null = this.spacer;
    const row: HTMLElement | null = this.row;
    if (spacer === null || row === null) {
      return;
    }
    // Write only when the size actually changes, so a no-op ResizeObserver tick or a repeated render
    // does not needlessly invalidate layout. Comparing against the live inline value keeps this correct
    // even if the engine normalises the string (a mismatch just falls back to writing, as before).
    const value: string = `0 0 ${this.spacerWidth(row, spacer)}px`;
    if (spacer.style.flex !== value) {
      spacer.style.flex = value;
    }
  }

  /**
   * Computes the trailing spacer width for the current mode and layout.
   * @param row The scrolling row.
   * @param spacer The trailing spacer (excluded from the column measurements).
   * @returns Returns the spacer width in pixels.
   */
  private spacerWidth(row: HTMLElement, spacer: HTMLElement): number {
    if (this.scrollMode() !== 'absolute-left') {
      return 0;
    }
    const tiles: readonly HTMLElement[] = Array.from(row.children).filter(
      (child: Element): child is HTMLElement =>
        child !== spacer && (child as HTMLElement).offsetParent !== null,
    );
    const last: HTMLElement | undefined = tiles[tiles.length - 1];
    if (last === undefined) {
      return 0;
    }
    const columnsWidth: number = tiles.reduce(
      (total: number, tile: HTMLElement): number => total + tile.offsetWidth,
      0,
    );
    // Only when the columns overflow is trailing room needed; then the last column reaches the leading
    // edge once the spacer fills the row's width beyond it.
    if (columnsWidth <= row.clientWidth) {
      return 0;
    }
    return Math.max(0, row.clientWidth - last.offsetWidth);
  }

  /**
   * Reads the current scroll mode from settings.
   * @returns Returns the configured scroll mode.
   */
  private scrollMode(): TileScrollMode {
    return this.settings.missionControlTileScrollMode();
  }
}
