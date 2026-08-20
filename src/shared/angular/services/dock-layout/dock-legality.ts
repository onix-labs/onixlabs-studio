import { DockSide, StackRole } from './dock-node';

/**
 * An axis-aligned rectangle in viewport coordinates.
 */
export interface Rect {
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
 * Describes which compass guides are legal for a given drag, keyed by guide.
 */
export interface GuideLegality {
  /**
   * Gets a value indicating whether the centre (tab-into) guide is legal.
   */
  readonly center: boolean;

  /**
   * Gets a value indicating whether the left (split) guide is legal.
   */
  readonly left: boolean;

  /**
   * Gets a value indicating whether the right (split) guide is legal.
   */
  readonly right: boolean;

  /**
   * Gets a value indicating whether the top (split) guide is legal.
   */
  readonly top: boolean;

  /**
   * Gets a value indicating whether the bottom (split) guide is legal.
   */
  readonly bottom: boolean;
}

/**
 * A resolved drop target: tab into a stack, occupy an empty centre well, split beside a stack, or
 * dock first-class to an edge. `occupy` is distinct from `tab` — a tool dropped on the blank centre
 * takes over the well's slot (its role flips to `tool`) rather than joining the well's tab strip,
 * which documents-only wells never allow.
 */
export type DockTarget =
  | { readonly kind: 'tab'; readonly stackId: string }
  | { readonly kind: 'occupy'; readonly stackId: string }
  | { readonly kind: 'split'; readonly stackId: string; readonly side: DockSide }
  | { readonly kind: 'edge'; readonly side: DockSide };

/**
 * A resolved drop target paired with the preview rectangle that highlights where the panel lands.
 */
export interface DockResolution {
  /**
   * Gets the resolved drop target.
   */
  readonly target: DockTarget;

  /**
   * Gets the preview rectangle to highlight.
   */
  readonly preview: Rect;
}

/**
 * The half-width of the central tab-into zone, as a fraction of a group's size. A cursor within
 * this band of both axes' centres tabs into the group; outside it splits the nearest edge.
 */
export const CENTER_ZONE_FRACTION: number = 0.34;

/**
 * The pixel size of a compass guide square, mirroring the 2.125rem `.dock-overlay__guide` at the
 * 16px root, so the guides can be hit-tested as explicit drop targets.
 */
export const COMPASS_GUIDE_SIZE: number = 34;

/**
 * The pixel distance from the compass centre to a directional guide's centre, mirroring the
 * 2.3125rem guide inset in `dock-overlay.scss` at the 16px root.
 */
export const COMPASS_GUIDE_OFFSET: number = 37;

/**
 * The distance, in pixels, within which a cursor near the workspace border docks to that edge.
 */
export const EDGE_THRESHOLD: number = 28;

/**
 * The pixel size of an edge guide square; the single source of truth shared by the overlay that
 * draws the guide and the hit-test that targets it.
 */
export const EDGE_GUIDE_SIZE: number = 40;

/**
 * The pixel inset of an edge guide from its workspace border.
 */
export const EDGE_GUIDE_INSET: number = 14;

/**
 * The maximum thickness, in pixels, of an edge-dock preview slab.
 */
const EDGE_SLAB_MAXIMUM: number = 280;

/**
 * The fraction of the workspace an edge-dock preview slab spans along the docking axis.
 */
const EDGE_SLAB_FRACTION: number = 0.32;

/**
 * Determines which workspace edge a rectangle sits nearest to, used to choose where an auto-hidden
 * stack is shelved.
 * @param rect The rectangle to measure.
 * @param workspace The workspace rectangle.
 * @returns Returns the nearest edge.
 */
export function nearestEdge(rect: Rect, workspace: Rect): DockSide {
  const distances: Record<DockSide, number> = {
    left: rect.left - workspace.left,
    right: workspace.left + workspace.width - (rect.left + rect.width),
    top: rect.top - workspace.top,
    bottom: workspace.top + workspace.height - (rect.top + rect.height),
  };
  return (Object.keys(distances) as DockSide[]).reduce(
    (nearest: DockSide, candidate: DockSide): DockSide =>
      distances[candidate] < distances[nearest] ? candidate : nearest,
  );
}

/**
 * Computes which compass guides are legal when dragging a panel of one role over a stack of
 * another. Documents live only in document wells — they tab into or split a well and never
 * edge-dock or enter a tool stack. Tools dock anywhere, with one asymmetry at the centre well: the
 * centre guide is legal only over an **empty** well, where it means the tool takes over the blank
 * centre (an `occupy`, not a tab); over a well that **holds documents** the centre is dead, because
 * a tool cannot join a documents-only tab strip. The four splits are legal over a well either way —
 * docking a tool group along the edge of a blank centre is how a layout is arranged before any
 * document is open, and the well survives the split as the documents-home.
 * @param panelRole The role of the panel being dragged.
 * @param targetRole The role of the stack being hovered.
 * @param targetEmpty Whether the hovered stack currently holds no panels; only consulted for a tool
 * over a document well.
 * @returns Returns the legality of each guide.
 */
export function guideLegality(
  panelRole: StackRole,
  targetRole: StackRole,
  targetEmpty: boolean = false,
): GuideLegality {
  if (panelRole === 'document') {
    const ok: boolean = targetRole === 'document';
    return { center: ok, left: ok, right: ok, top: ok, bottom: ok };
  }
  if (targetRole === 'document') {
    return { center: targetEmpty, left: true, right: true, top: true, bottom: true };
  }
  return { center: true, left: true, right: true, top: true, bottom: true };
}

/**
 * Resolves the drop target for the centre guide over a hovered stack, distinguishing an occupy (a
 * tool taking over an empty centre well) from an ordinary tab-into. The caller has already checked
 * the centre guide is legal.
 * @param panelRole The role of the panel being dragged.
 * @param targetRole The role of the hovered stack.
 * @param stackId The identifier of the hovered stack.
 * @returns Returns the centre drop target.
 */
function centerTarget(panelRole: StackRole, targetRole: StackRole, stackId: string): DockTarget {
  return panelRole === 'tool' && targetRole === 'document'
    ? { kind: 'occupy', stackId }
    : { kind: 'tab', stackId };
}

/**
 * Builds the preview slab for an edge dock.
 * @param side The edge being docked against.
 * @param workspace The workspace rectangle.
 * @returns Returns the preview rectangle.
 */
function edgePreview(side: DockSide, workspace: Rect): Rect {
  const thickness: number = Math.min(EDGE_SLAB_MAXIMUM, workspace.width * EDGE_SLAB_FRACTION);
  const height: number = Math.min(EDGE_SLAB_MAXIMUM, workspace.height * EDGE_SLAB_FRACTION);
  switch (side) {
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
 * @param side The edge the guide marks.
 * @param workspace The workspace rectangle.
 * @returns Returns the guide's rectangle.
 */
export function edgeGuideRect(side: DockSide, workspace: Rect): Rect {
  const centreX: number = workspace.left + workspace.width / 2 - EDGE_GUIDE_SIZE / 2;
  const centreY: number = workspace.top + workspace.height / 2 - EDGE_GUIDE_SIZE / 2;
  const size: number = EDGE_GUIDE_SIZE;
  switch (side) {
    case 'left':
      return { left: workspace.left + EDGE_GUIDE_INSET, top: centreY, width: size, height: size };
    case 'right':
      return {
        left: workspace.left + workspace.width - EDGE_GUIDE_INSET - size,
        top: centreY,
        width: size,
        height: size,
      };
    case 'top':
      return { left: centreX, top: workspace.top + EDGE_GUIDE_INSET, width: size, height: size };
    case 'bottom':
      return {
        left: centreX,
        top: workspace.top + workspace.height - EDGE_GUIDE_INSET - size,
        width: size,
        height: size,
      };
  }
}

/**
 * Resolves an edge dock when the cursor is near a workspace border. Edge docking is first-class and
 * available to tool windows only.
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param workspace The workspace rectangle.
 * @param panelRole The role of the panel being dragged.
 * @returns Returns the edge resolution, or null when no edge is targeted.
 */
export function resolveEdgeTarget(
  x: number,
  y: number,
  workspace: Rect,
  panelRole: StackRole,
): DockResolution | null {
  if (panelRole !== 'tool') {
    return null;
  }
  const left: number = x - workspace.left;
  const right: number = workspace.left + workspace.width - x;
  const top: number = y - workspace.top;
  const bottom: number = workspace.top + workspace.height - y;
  if (left < 0 || right < 0 || top < 0 || bottom < 0) {
    return null;
  }
  const nearest: number = Math.min(left, right, top, bottom);
  if (nearest > EDGE_THRESHOLD) {
    return null;
  }
  const side: DockSide =
    nearest === left ? 'left' : nearest === right ? 'right' : nearest === top ? 'top' : 'bottom';
  return { target: { kind: 'edge', side }, preview: edgePreview(side, workspace) };
}

/**
 * Resolves an edge dock from the edge guide the cursor is directly over, so the whole guide square
 * is a target (not just the band of it within the border threshold). Available to tool windows only.
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param workspace The workspace rectangle.
 * @param panelRole The role of the panel being dragged.
 * @returns Returns the edge resolution, or null when the cursor is over no edge guide.
 */
export function resolveEdgeGuideTarget(
  x: number,
  y: number,
  workspace: Rect,
  panelRole: StackRole,
): DockResolution | null {
  if (panelRole !== 'tool') {
    return null;
  }
  const sides: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];
  for (const side of sides) {
    const rect: Rect = edgeGuideRect(side, workspace);
    if (
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    ) {
      return { target: { kind: 'edge', side }, preview: edgePreview(side, workspace) };
    }
  }
  return null;
}

/**
 * Builds the preview rectangle for a split dock against one side of a group.
 * @param side The side being split.
 * @param rect The group rectangle.
 * @returns Returns the preview rectangle (half the group).
 */
function splitPreview(side: DockSide, rect: Rect): Rect {
  const halfWidth: number = rect.width / 2;
  const halfHeight: number = rect.height / 2;
  switch (side) {
    case 'left':
      return { left: rect.left, top: rect.top, width: halfWidth, height: rect.height };
    case 'right':
      return { left: rect.left + halfWidth, top: rect.top, width: halfWidth, height: rect.height };
    case 'top':
      return { left: rect.left, top: rect.top, width: rect.width, height: halfHeight };
    case 'bottom':
      return { left: rect.left, top: rect.top + halfHeight, width: rect.width, height: halfHeight };
  }
}

/**
 * Resolves a dock against a hovered group: the central zone tabs into the group, the outer zones
 * split its nearest edge. Illegal zones resolve to null so the panel cannot drop there.
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param stackId The identifier of the hovered stack.
 * @param targetRole The role of the hovered stack.
 * @param rect The hovered group's rectangle.
 * @param panelRole The role of the panel being dragged.
 * @param targetEmpty Whether the hovered stack currently holds no panels.
 * @returns Returns the group resolution, or null when the cursor is outside the group or the zone
 * is illegal.
 */
export function resolveGroupTarget(
  x: number,
  y: number,
  stackId: string,
  targetRole: StackRole,
  rect: Rect,
  panelRole: StackRole,
  targetEmpty: boolean = false,
): DockResolution | null {
  const fx: number = (x - rect.left) / rect.width;
  const fy: number = (y - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
    return null;
  }
  const legal: GuideLegality = guideLegality(panelRole, targetRole, targetEmpty);
  const inCenter: boolean =
    fx >= CENTER_ZONE_FRACTION &&
    fx <= 1 - CENTER_ZONE_FRACTION &&
    fy >= CENTER_ZONE_FRACTION &&
    fy <= 1 - CENTER_ZONE_FRACTION;

  if (inCenter) {
    return legal.center
      ? { target: centerTarget(panelRole, targetRole, stackId), preview: rect }
      : null;
  }

  const distances: Record<DockSide, number> = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  const side: DockSide = (Object.keys(distances) as DockSide[]).reduce(
    (nearest: DockSide, candidate: DockSide): DockSide =>
      distances[candidate] < distances[nearest] ? candidate : nearest,
  );
  return legal[side]
    ? { target: { kind: 'split', stackId, side }, preview: splitPreview(side, rect) }
    : null;
}

/**
 * Resolves a dock from the compass guide the cursor is directly over, so the arrows act as explicit
 * drop targets regardless of where they sit within the group. The guide rectangles are derived from
 * the compass centre (the hovered group's centre) and the fixed offsets that mirror the overlay's
 * layout.
 * @param x The cursor's viewport x coordinate.
 * @param y The cursor's viewport y coordinate.
 * @param centerX The compass centre x coordinate (the hovered group's centre).
 * @param centerY The compass centre y coordinate.
 * @param stackId The identifier of the hovered stack.
 * @param targetRole The role of the hovered stack.
 * @param rect The hovered group's rectangle.
 * @param panelRole The role of the panel being dragged.
 * @param targetEmpty Whether the hovered stack currently holds no panels.
 * @returns Returns the guide resolution, or null when the cursor is over no guide (so callers fall
 * back to the position-based zones) or over an illegal guide.
 */
export function resolveCompassTarget(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  stackId: string,
  targetRole: StackRole,
  rect: Rect,
  panelRole: StackRole,
  targetEmpty: boolean = false,
): DockResolution | null {
  const guides: readonly {
    readonly key: 'center' | DockSide;
    readonly dx: number;
    readonly dy: number;
  }[] = [
    { key: 'center', dx: 0, dy: 0 },
    { key: 'left', dx: -COMPASS_GUIDE_OFFSET, dy: 0 },
    { key: 'right', dx: COMPASS_GUIDE_OFFSET, dy: 0 },
    { key: 'top', dx: 0, dy: -COMPASS_GUIDE_OFFSET },
    { key: 'bottom', dx: 0, dy: COMPASS_GUIDE_OFFSET },
  ];
  const half: number = COMPASS_GUIDE_SIZE / 2;
  const legal: GuideLegality = guideLegality(panelRole, targetRole, targetEmpty);
  for (const guide of guides) {
    if (Math.abs(x - (centerX + guide.dx)) > half || Math.abs(y - (centerY + guide.dy)) > half) {
      continue;
    }
    if (!legal[guide.key]) {
      return null;
    }
    return guide.key === 'center'
      ? { target: centerTarget(panelRole, targetRole, stackId), preview: rect }
      : {
          target: { kind: 'split', stackId, side: guide.key },
          preview: splitPreview(guide.key, rect),
        };
  }
  return null;
}
