import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { Agent } from '@shared/angular/services/agent/agent';

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
 * A live agent tile registered with Mission Control: its agent session, and how to re-sync the tile
 * to the latest stored conversation for its context. Registered while a tile is mounted so the ribbon
 * can act across every tile (stop the running ones, re-sync them all) without reaching into each.
 */
export interface MissionControlAgentHandle {
  /**
   * Gets the identifier of the tab the tile represents.
   */
  readonly tabId: string;

  /**
   * Gets the tile's agent session.
   */
  readonly agent: Agent;

  /**
   * Re-synchronises the tile to the most recent stored conversation for its context.
   */
  readonly sync: () => void;
}

/**
 * The Mission Control feature's shared state, driving both the view and its ribbon. It tracks each
 * open tile's agent (so the ribbon can stop or re-sync them all at once), the per-tile width overrides
 * the user sets by dragging (keyed by tab so a tile keeps its width while the view is open), and
 * whether idle agents are shown. It is a root singleton — Mission Control is a singleton tab, and the
 * contextual ribbon is mounted by the shell in a different injector branch than the view, so both
 * (and the tiles) must share the one app-level instance.
 */
@Service()
export class MissionControl {
  /**
   * Holds the registered agent tiles.
   */
  private readonly handleList: WritableSignal<readonly MissionControlAgentHandle[]> = signal<
    readonly MissionControlAgentHandle[]
  >([]);

  /**
   * Holds the per-tile width overrides, keyed by tab identifier. A tab with no entry uses the default
   * width.
   */
  private readonly widthMap: WritableSignal<ReadonlyMap<string, number>> = signal<
    ReadonlyMap<string, number>
  >(new Map<string, number>());

  /**
   * Holds whether tiles whose agent is idle (no conversation and not running) are shown.
   */
  private readonly showIdleState: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets whether idle agent tiles are shown.
   */
  public readonly showIdle: Signal<boolean> = this.showIdleState.asReadonly();

  /**
   * Gets the number of registered tiles whose agent is currently running.
   */
  public readonly runningCount: Signal<number> = computed(
    (): number =>
      this.handleList().filter((handle: MissionControlAgentHandle): boolean =>
        handle.agent.isRunning(),
      ).length,
  );

  /**
   * Registers an agent tile so the ribbon can act across every tile. The returned function
   * unregisters it when the tile is destroyed.
   * @param handle The tile to register.
   * @returns Returns a function that unregisters the tile.
   */
  public registerAgent(handle: MissionControlAgentHandle): () => void {
    this.handleList.update(
      (current: readonly MissionControlAgentHandle[]): readonly MissionControlAgentHandle[] => [
        ...current,
        handle,
      ],
    );
    return (): void => {
      this.handleList.update(
        (current: readonly MissionControlAgentHandle[]): readonly MissionControlAgentHandle[] =>
          current.filter(
            (existing: MissionControlAgentHandle): boolean => existing !== handle,
          ),
      );
    };
  }

  /**
   * Gets the width, in pixels, a tile should render at: the user's override for that tab, or the
   * default.
   * @param tabId The tab identifier.
   * @returns Returns the tile's width in pixels.
   */
  public widthFor(tabId: string): number {
    return this.widthMap().get(tabId) ?? DEFAULT_TILE_WIDTH;
  }

  /**
   * Sets a tile's width, clamped to the minimum. Called live as the user drags a tile's resize grip.
   * @param tabId The tab identifier.
   * @param width The desired width in pixels.
   */
  public setWidth(tabId: string, width: number): void {
    const clamped: number = Math.max(MIN_TILE_WIDTH, Math.round(width));
    this.widthMap.update((current: ReadonlyMap<string, number>): ReadonlyMap<string, number> => {
      const next: Map<string, number> = new Map<string, number>(current);
      next.set(tabId, clamped);
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
   * Sets whether idle agent tiles are shown.
   * @param value Whether to show idle tiles.
   */
  public setShowIdle(value: boolean): void {
    this.showIdleState.set(value);
  }

  /**
   * Stops every running agent tile.
   */
  public stopAll(): void {
    for (const handle of this.handleList()) {
      if (handle.agent.isRunning()) {
        handle.agent.stop();
      }
    }
  }

  /**
   * Re-synchronises every tile to the latest stored conversation for its context, so runs started in
   * the origin tabs are picked up.
   */
  public syncAll(): void {
    for (const handle of this.handleList()) {
      handle.sync();
    }
  }
}
