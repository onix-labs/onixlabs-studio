import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Specifies the width, in pixels, a Mission Control agent tile opens at before the user resizes it.
 */
export const DEFAULT_TILE_WIDTH: number = 420;

/**
 * Specifies the smallest width, in pixels, a Mission Control agent tile can be dragged to. Matches the
 * floor the docked agent panels use across the app so the agent UI stays usable.
 */
export const MIN_TILE_WIDTH: number = 240;

/**
 * The Mission Control feature's shared view state: the per-tile width overrides the user sets by
 * dragging (keyed so a tile keeps its width while the view is open) and whether idle agents are shown.
 * A root singleton — Mission Control is a singleton tab, and the view, tiles, and contextual ribbon
 * (mounted by the shell in a different injector branch) must share one instance. The live agent list
 * itself lives in {@link import('@shared/angular/services/agent-hosts/agent-hosts').AgentHosts}.
 */
@Service()
export class MissionControl {
  /**
   * Holds the per-tile width overrides, keyed by tile key. A tile with no entry uses the default width.
   */
  private readonly widthMap: WritableSignal<ReadonlyMap<string, number>> = signal<
    ReadonlyMap<string, number>
  >(new Map<string, number>());

  /**
   * Holds whether empty agent tiles (no conversation, not running) are hidden.
   */
  private readonly hideEmptyState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether idle agent tiles (a settled conversation awaiting the next prompt) are hidden.
   */
  private readonly hideIdleState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the ids of the hosts the user has manually hidden, keyed by host id (the stable id shared by
   * the rail rows and the tiles). Manual hiding is OR-ed with Hide Empty and Hide Idle: an agent is
   * hidden when the user has hidden it, or when a blanket toggle catches it.
   */
  private readonly hiddenHostsState: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets whether empty agent tiles are hidden.
   */
  public readonly hideEmpty: Signal<boolean> = this.hideEmptyState.asReadonly();

  /**
   * Gets whether idle agent tiles are hidden.
   */
  public readonly hideIdle: Signal<boolean> = this.hideIdleState.asReadonly();

  /**
   * Gets the set of host ids the user has manually hidden.
   */
  public readonly hiddenHosts: Signal<ReadonlySet<string>> = this.hiddenHostsState.asReadonly();

  /**
   * Gets the width, in pixels, a tile should render at: the user's override for that key, or the
   * default.
   * @param key The tile's stable key.
   * @returns Returns the tile's width in pixels.
   */
  public widthFor(key: string): number {
    return this.widthMap().get(key) ?? DEFAULT_TILE_WIDTH;
  }

  /**
   * Sets a tile's width, clamped to the minimum. Called live as the user drags a tile's resize grip.
   * @param key The tile's stable key.
   * @param width The desired width in pixels.
   */
  public setWidth(key: string, width: number): void {
    const clamped: number = Math.max(MIN_TILE_WIDTH, Math.round(width));
    this.widthMap.update((current: ReadonlyMap<string, number>): ReadonlyMap<string, number> => {
      const next: Map<string, number> = new Map<string, number>(current);
      next.set(key, clamped);
      return next;
    });
  }

  /**
   * Clears every tile width override, returning all tiles to the default width.
   */
  public resetWidths(): void {
    this.widthMap.set(new Map<string, number>());
  }

  /**
   * Sets whether empty agent tiles are hidden.
   * @param value Whether to hide empty tiles.
   */
  public setHideEmpty(value: boolean): void {
    this.hideEmptyState.set(value);
  }

  /**
   * Sets whether idle agent tiles are hidden.
   * @param value Whether to hide idle tiles.
   */
  public setHideIdle(value: boolean): void {
    this.hideIdleState.set(value);
  }

  /**
   * Gets whether the user has manually hidden the given host.
   * @param id The host id.
   * @returns Returns true when the host is manually hidden.
   */
  public isHostHidden(id: string): boolean {
    return this.hiddenHostsState().has(id);
  }

  /**
   * Sets whether the given host is manually hidden, leaving the set untouched when already in the
   * desired state so unrelated tiles do not recompute.
   * @param id The host id.
   * @param value Whether to hide the host.
   */
  public setHostHidden(id: string, value: boolean): void {
    this.hiddenHostsState.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      if (current.has(id) === value) {
        return current;
      }
      const next: Set<string> = new Set<string>(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /**
   * Toggles whether the given host is manually hidden.
   * @param id The host id.
   */
  public toggleHostHidden(id: string): void {
    this.setHostHidden(id, !this.hiddenHostsState().has(id));
  }
}
