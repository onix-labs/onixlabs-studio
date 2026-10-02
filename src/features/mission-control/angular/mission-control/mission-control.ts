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
 * Names the faces Mission Control can show: the live agents as columns, or the open projects' work-item
 * hierarchy (epic #788).
 */
export type MissionControlFace = 'agents' | 'hierarchy';

/**
 * The Mission Control feature's shared view state: the per-tile width overrides the user sets by
 * dragging (keyed so a tile keeps its width while the view is open) and which run states are shown.
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
   * Holds the face on show.
   */
  private readonly faceState: WritableSignal<MissionControlFace> =
    signal<MissionControlFace>('agents');

  /**
   * Holds whether the hierarchy lists standalone issues: open issues with no parent and no children.
   * Off by default — they are the bugs and one-off requests that sit outside any initiative, and on a
   * busy repository they would bury the epics the face is for.
   */
  private readonly showStandaloneState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether empty agent tiles (no conversation, not running) are hidden.
   */
  private readonly hideEmptyState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether idle agent tiles (a settled conversation awaiting the next prompt) are hidden.
   */
  private readonly hideIdleState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether working agent tiles (a run in flight) are hidden.
   */
  private readonly hideWorkingState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the ids of the hosts the user has manually hidden, keyed by host id (the stable id shared by
   * the rail rows and the tiles). Manual hiding is OR-ed with the blanket toggles: an agent is hidden
   * when the user has hidden it, or when Hide Empty, Hide Idle or Hide Working catches it.
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
   * Gets whether working agent tiles are hidden.
   */
  public readonly hideWorking: Signal<boolean> = this.hideWorkingState.asReadonly();

  /**
   * Gets the set of host ids the user has manually hidden.
   */
  public readonly hiddenHosts: Signal<ReadonlySet<string>> = this.hiddenHostsState.asReadonly();

  /**
   * Gets the face on show.
   */
  public readonly face: Signal<MissionControlFace> = this.faceState.asReadonly();

  /**
   * Gets whether the hierarchy lists standalone issues.
   */
  public readonly showStandalone: Signal<boolean> = this.showStandaloneState.asReadonly();

  /**
   * Shows a face.
   * @param face The face to show.
   */
  public setFace(face: MissionControlFace): void {
    this.faceState.set(face);
  }

  /**
   * Sets whether the hierarchy lists standalone issues.
   * @param value Whether to list them.
   */
  public setShowStandalone(value: boolean): void {
    this.showStandaloneState.set(value);
  }

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
   * Sets whether working agent tiles are hidden.
   * @param value Whether to hide working tiles.
   */
  public setHideWorking(value: boolean): void {
    this.hideWorkingState.set(value);
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
