/**
 * Specifies the edge of the panel layout a panel docks to.
 */
export type PanelEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Gets the panel edges in a stable render order.
 */
export const PANEL_EDGES: readonly PanelEdge[] = ['left', 'right', 'top', 'bottom'];

/**
 * An axis-aligned rectangle in viewport coordinates.
 */
export interface PanelRect {
  /**
   * Gets the distance from the viewport's left edge to the rectangle's left edge.
   */
  readonly left: number;

  /**
   * Gets the distance from the viewport's top edge to the rectangle's top edge.
   */
  readonly top: number;

  /**
   * Gets the width of the rectangle.
   */
  readonly width: number;

  /**
   * Gets the height of the rectangle.
   */
  readonly height: number;
}

/**
 * Describes where one panel lives within a layout: its docking edge, its position within that
 * edge's stack, and its cross-axis size in pixels (width for left/right, height for top/bottom).
 */
export interface PanelPlacement {
  /**
   * Gets the edge the panel docks to.
   */
  readonly edge: PanelEdge;

  /**
   * Gets the panel's position within its edge's stack.
   */
  readonly order: number;

  /**
   * Gets the panel's cross-axis size in pixels.
   */
  readonly size: number;
}

/**
 * A whole layout arrangement, keyed by stable panel identifier.
 */
export type PanelArrangement = Readonly<Record<string, PanelPlacement>>;

/**
 * The distance, in pixels, within which a cursor near a layout border docks to that edge.
 */
export const PANEL_EDGE_THRESHOLD: number = 28;

/**
 * The pixel size of an edge guide square; the single source of truth shared by the overlay that
 * draws the guide and the hit-test that targets it.
 */
export const PANEL_EDGE_GUIDE_SIZE: number = 40;

/**
 * The pixel inset of an edge guide from its layout border.
 */
export const PANEL_EDGE_GUIDE_INSET: number = 14;

/**
 * The maximum thickness, in pixels, of an edge-dock preview slab.
 */
const EDGE_SLAB_MAXIMUM: number = 280;

/**
 * The fraction of the layout an edge-dock preview slab spans along the docking axis.
 */
const EDGE_SLAB_FRACTION: number = 0.32;

/**
 * Builds the preview slab highlighting where a panel lands when docked to an edge.
 * @param edge The edge being docked against.
 * @param workspace The layout's workspace rectangle.
 * @returns Returns the preview rectangle.
 */
export function panelEdgePreview(edge: PanelEdge, workspace: PanelRect): PanelRect {
  const thickness: number = Math.min(EDGE_SLAB_MAXIMUM, workspace.width * EDGE_SLAB_FRACTION);
  const height: number = Math.min(EDGE_SLAB_MAXIMUM, workspace.height * EDGE_SLAB_FRACTION);
  switch (edge) {
    case 'left':
      return {
        left: workspace.left,
        top: workspace.top,
        width: thickness,
        height: workspace.height,
      };
    case 'right':
      return {
        left: workspace.left + workspace.width - thickness,
        top: workspace.top,
        width: thickness,
        height: workspace.height,
      };
    case 'top':
      return { left: workspace.left, top: workspace.top, width: workspace.width, height };
    case 'bottom':
      return {
        left: workspace.left,
        top: workspace.top + workspace.height - height,
        width: workspace.width,
        height,
      };
  }
}

/**
 * Computes the rectangle of an edge guide square within the workspace. Shared by the overlay (to
 * draw the guide) and the hit-test (to target it), so the two never drift apart.
 * @param edge The edge the guide marks.
 * @param workspace The layout's workspace rectangle.
 * @returns Returns the guide's rectangle.
 */
export function panelEdgeGuideRect(edge: PanelEdge, workspace: PanelRect): PanelRect {
  const size: number = PANEL_EDGE_GUIDE_SIZE;
  const centreX: number = workspace.left + workspace.width / 2 - size / 2;
  const centreY: number = workspace.top + workspace.height / 2 - size / 2;
  switch (edge) {
    case 'left':
      return {
        left: workspace.left + PANEL_EDGE_GUIDE_INSET,
        top: centreY,
        width: size,
        height: size,
      };
    case 'right':
      return {
        left: workspace.left + workspace.width - PANEL_EDGE_GUIDE_INSET - size,
        top: centreY,
        width: size,
        height: size,
      };
    case 'top':
      return {
        left: centreX,
        top: workspace.top + PANEL_EDGE_GUIDE_INSET,
        width: size,
        height: size,
      };
    case 'bottom':
      return {
        left: centreX,
        top: workspace.top + workspace.height - PANEL_EDGE_GUIDE_INSET - size,
        width: size,
        height: size,
      };
  }
}

/**
 * Resolves an edge dock when the cursor is near a layout border. Every edge is always a legal
 * target: the layout's centre is fixed, so a dragged panel can only land on an edge.
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param workspace The layout's workspace rectangle.
 * @returns Returns the targeted edge, or null when the cursor is inside no border band.
 */
export function resolvePanelEdgeTarget(
  x: number,
  y: number,
  workspace: PanelRect,
): PanelEdge | null {
  const left: number = x - workspace.left;
  const right: number = workspace.left + workspace.width - x;
  const top: number = y - workspace.top;
  const bottom: number = workspace.top + workspace.height - y;
  if (left < 0 || right < 0 || top < 0 || bottom < 0) {
    return null;
  }
  const nearest: number = Math.min(left, right, top, bottom);
  if (nearest > PANEL_EDGE_THRESHOLD) {
    return null;
  }
  return nearest === left
    ? 'left'
    : nearest === right
      ? 'right'
      : nearest === top
        ? 'top'
        : 'bottom';
}

/**
 * Resolves an edge dock from the edge guide the cursor is directly over, so the whole guide square
 * is a target (not just the band of it within the border threshold).
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param workspace The layout's workspace rectangle.
 * @returns Returns the targeted edge, or null when the cursor is over no edge guide.
 */
export function resolvePanelEdgeGuideTarget(
  x: number,
  y: number,
  workspace: PanelRect,
): PanelEdge | null {
  for (const edge of PANEL_EDGES) {
    const rect: PanelRect = panelEdgeGuideRect(edge, workspace);
    if (
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    ) {
      return edge;
    }
  }
  return null;
}

/**
 * Rebuilds an arrangement from a value read out of persistence: validates each entry's structure
 * and normalizes each edge's orders to a dense `0..n-1` sequence.
 *
 * Entries are validated for shape only, not pruned against the panels currently mounted — panels
 * mount conditionally (an agent panel exists only once opened), so an id absent right now may
 * mount later and must keep its placement. A stale id from a removed panel lingers as a few inert
 * bytes, which is preferable to discarding a user's arrangement.
 * @param raw The value read from the store (untrusted — may be null, malformed, or from an older
 * schema).
 * @returns Returns the usable arrangement entries; empty when nothing usable survives.
 */
export function restorePanelArrangement(raw: unknown): PanelArrangement {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const entries: Record<string, PanelPlacement> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isPersistedPlacement(value)) {
      entries[id] = { edge: value.edge, order: value.order, size: value.size };
    }
  }
  return normalizeOrders(entries);
}

/**
 * Normalizes each edge's orders to a dense `0..n-1` sequence, preserving relative order.
 * @param arrangement The arrangement to normalize.
 * @returns Returns the normalized arrangement.
 */
export function normalizeOrders(arrangement: PanelArrangement): PanelArrangement {
  const normalized: Record<string, PanelPlacement> = { ...arrangement };
  for (const edge of PANEL_EDGES) {
    const ids: string[] = Object.keys(normalized)
      .filter((id: string): boolean => normalized[id].edge === edge)
      .sort((a: string, b: string): number => normalized[a].order - normalized[b].order);
    ids.forEach((id: string, index: number): void => {
      normalized[id] = { ...normalized[id], order: index };
    });
  }
  return normalized;
}

/**
 * Docks a panel to an edge, appending it at the end of that edge's stack. Re-docking to the
 * panel's current edge moves it to the end of that stack. A panel without a placement is left
 * unplaced.
 * @param arrangement The arrangement to mutate.
 * @param panelId The identifier of the panel to move.
 * @param edge The edge to dock the panel to.
 * @returns Returns the mutated, order-normalized arrangement.
 */
export function movePanel(
  arrangement: PanelArrangement,
  panelId: string,
  edge: PanelEdge,
): PanelArrangement {
  const existing: PanelPlacement | undefined = arrangement[panelId];
  if (existing === undefined) {
    return arrangement;
  }
  const end: number = Object.values(arrangement).filter(
    (placement: PanelPlacement): boolean => placement.edge === edge,
  ).length;
  return normalizeOrders({ ...arrangement, [panelId]: { ...existing, edge, order: end } });
}

/**
 * Sets the cross-axis size of an edge's stack. The whole stack shares one size, so every panel on
 * the edge is written — a panel dragged away later then keeps the size it last had.
 * @param arrangement The arrangement to mutate.
 * @param edge The edge to resize.
 * @param size The new cross-axis size in pixels.
 * @returns Returns the mutated arrangement.
 */
export function resizeEdgePanels(
  arrangement: PanelArrangement,
  edge: PanelEdge,
  size: number,
): PanelArrangement {
  const next: Record<string, PanelPlacement> = { ...arrangement };
  for (const [id, placement] of Object.entries(next)) {
    if (placement.edge === edge) {
      next[id] = { ...placement, size };
    }
  }
  return next;
}

/**
 * Determines whether an untrusted value parsed from storage is a structurally valid placement.
 * @param value The value to test.
 * @returns Returns true when the value is a well-formed {@link PanelPlacement}.
 */
function isPersistedPlacement(value: unknown): value is PanelPlacement {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const placement: Record<string, unknown> = value as Record<string, unknown>;
  return (
    (PANEL_EDGES as readonly unknown[]).includes(placement['edge']) &&
    typeof placement['order'] === 'number' &&
    Number.isFinite(placement['order']) &&
    typeof placement['size'] === 'number' &&
    Number.isFinite(placement['size']) &&
    placement['size'] > 0
  );
}
