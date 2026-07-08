import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import {
  movePanel,
  normalizeOrders,
  PanelArrangement,
  PanelEdge,
  PanelPlacement,
  resizeEdgePanels,
  resizePanel,
  restorePanelArrangement,
} from './panel-types';

/**
 * Holds the persisted panel arrangement of every panel-layout view type, keyed by layout key
 * (`markdown`, `code`, `terminal`, …). Deliberately an application singleton rather than a
 * per-layout instance: every open tab of a view type reads the same signal, so docking a panel in
 * one tab reflects instantly in every other — localStorage raises no same-document change events,
 * so per-instance stores reading the same key would silently diverge until reload.
 *
 * Each arrangement is persisted under `panel-layout.<key>` on every mutation and restored (with
 * shape validation) on first access.
 */
@Service()
export class PanelArrangements {
  /**
   * Holds the store arrangements persist to.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds one live arrangement signal per layout key, created lazily on first access.
   */
  private readonly arrangements: Map<string, WritableSignal<PanelArrangement>> = new Map<
    string,
    WritableSignal<PanelArrangement>
  >();

  /**
   * Gets the live arrangement for a layout key. The same signal instance is returned for every
   * caller with the same key, which is what keeps simultaneous tabs of one view type in sync.
   * @param key The layout key.
   * @returns Returns the arrangement signal.
   */
  public arrangement(key: string): Signal<PanelArrangement> {
    return this.arrangementOf(key).asReadonly();
  }

  /**
   * Declares panels and their default placements for a layout key, merging defaults for any panel
   * that has no restored placement yet. Called by a layout whenever its mounted panel set changes;
   * panels that mount later (behind an `@if`) simply merge in when they first appear. Defaults
   * never overwrite an existing placement, and merging alone is not persisted — only user
   * mutations write to the store.
   * @param key The layout key.
   * @param defaults The default placement of each panel, keyed by panel identifier.
   */
  public initialize(key: string, defaults: PanelArrangement): void {
    const current: WritableSignal<PanelArrangement> = this.arrangementOf(key);
    const merged: Record<string, PanelPlacement> = { ...current() };
    let changed: boolean = false;
    for (const [id, placement] of Object.entries(defaults)) {
      if (!(id in merged)) {
        merged[id] = placement;
        changed = true;
      }
    }
    if (changed) {
      current.set(normalizeOrders(merged));
    }
  }

  /**
   * Docks a panel to an edge, appending it at the end of that edge's stack, and persists the
   * result. Re-docking to the panel's current edge moves it to the end of that stack.
   * @param key The layout key.
   * @param panelId The identifier of the panel to move.
   * @param edge The edge to dock the panel to.
   */
  public move(key: string, panelId: string, edge: PanelEdge): void {
    const current: WritableSignal<PanelArrangement> = this.arrangementOf(key);
    this.commit(key, current, movePanel(current(), panelId, edge));
  }

  /**
   * Sets the cross-axis size of an edge's stack and persists the result. The whole stack shares
   * one size, so every panel on the edge is written — a panel dragged away later then keeps the
   * size it last had.
   * @param key The layout key.
   * @param edge The edge to resize.
   * @param size The new cross-axis size in pixels.
   */
  public resizeEdge(key: string, edge: PanelEdge, size: number): void {
    const current: WritableSignal<PanelArrangement> = this.arrangementOf(key);
    this.commit(key, current, resizeEdgePanels(current(), edge, size));
  }

  /**
   * Sets a single panel's own size and persists the result. Left and right edges tile their panels
   * as columns, each keeping its own width, so a resize writes only the dragged panel.
   * @param key The layout key.
   * @param panelId The identifier of the panel to resize.
   * @param size The panel's new size in pixels.
   */
  public resizePanel(key: string, panelId: string, size: number): void {
    const current: WritableSignal<PanelArrangement> = this.arrangementOf(key);
    this.commit(key, current, resizePanel(current(), panelId, size));
  }

  /**
   * Normalizes, applies and persists a mutated arrangement.
   * @param key The layout key.
   * @param current The live signal to update.
   * @param next The mutated arrangement.
   */
  private commit(
    key: string,
    current: WritableSignal<PanelArrangement>,
    next: PanelArrangement,
  ): void {
    const normalized: PanelArrangement = normalizeOrders(next);
    current.set(normalized);
    this.store.set(PanelArrangements.storeKey(key), normalized);
  }

  /**
   * Gets or lazily creates the writable arrangement for a layout key, restoring any persisted
   * value on first access.
   * @param key The layout key.
   * @returns Returns the writable arrangement signal.
   */
  private arrangementOf(key: string): WritableSignal<PanelArrangement> {
    let existing: WritableSignal<PanelArrangement> | undefined = this.arrangements.get(key);
    if (existing === undefined) {
      const restored: PanelArrangement = restorePanelArrangement(
        this.store.get<unknown>(PanelArrangements.storeKey(key), null),
      );
      existing = signal<PanelArrangement>(restored);
      this.arrangements.set(key, existing);
    }
    return existing;
  }

  /**
   * Builds the persistence key for a layout key.
   * @param key The layout key.
   * @returns Returns the store key.
   */
  private static storeKey(key: string): string {
    return `panel-layout.${key}`;
  }
}
