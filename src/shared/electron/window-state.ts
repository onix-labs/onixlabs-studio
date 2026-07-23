/**
 * Describes a window rectangle in screen coordinates. Mirrors Electron's `Rectangle` without
 * depending on the electron module, so the restore logic stays pure and unit-testable.
 */
export interface WindowRect {
  /**
   * Gets the x-coordinate of the rectangle's left edge.
   */
  readonly x: number;

  /**
   * Gets the y-coordinate of the rectangle's top edge.
   */
  readonly y: number;

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
 * Describes the persisted state of a window: its last normal (unmaximized) bounds and whether it
 * was maximized when last saved.
 */
export interface StoredWindowState {
  /**
   * Gets the window's last normal (unmaximized) bounds.
   */
  readonly bounds: WindowRect;

  /**
   * Gets a value indicating whether the window was maximized.
   */
  readonly maximized: boolean;
}

/**
 * Holds the minimum width (px) of the window's title strip that must remain visible on some display
 * for persisted bounds to be restored as-is; anything narrower could leave the window impossible to
 * grab.
 */
const MIN_VISIBLE_WIDTH: number = 100;

/**
 * Holds the height (px) of the strip along the window's top edge treated as the draggable title-bar
 * region for visibility purposes.
 */
const TITLE_STRIP_HEIGHT: number = 40;

/**
 * Holds the minimum height (px) of the title strip that must intersect a display's work area for
 * the window to count as grabbable there.
 */
const MIN_VISIBLE_STRIP_HEIGHT: number = 16;

/**
 * Parses a persisted window state defensively, so a corrupt or foreign state file can never produce
 * an unusable window.
 * @param value The raw persisted value.
 * @returns Returns the window state, or null when the value is not a usable state.
 */
export function parseStoredWindowState(value: unknown): StoredWindowState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const bounds: unknown = record['bounds'];
  if (typeof bounds !== 'object' || bounds === null) {
    return null;
  }
  const rect: Record<string, unknown> = bounds as Record<string, unknown>;
  const x: unknown = rect['x'];
  const y: unknown = rect['y'];
  const width: unknown = rect['width'];
  const height: unknown = rect['height'];
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { bounds: { x, y, width, height }, maximized: record['maximized'] === true };
}

/**
 * Restores a persisted window rectangle against the current displays. Bounds whose title strip is
 * still grabbable on some display are kept in place (with their size clamped to the nearest work
 * area); bounds stranded off-screen — a disconnected monitor, a changed arrangement — are re-centred
 * on the display they overlap most (falling back to the primary display).
 * @param stored The persisted window state.
 * @param workAreas The work areas of the connected displays, primary first.
 * @param minWidth The minimum window width to restore.
 * @param minHeight The minimum window height to restore.
 * @returns Returns the rectangle to restore, or null when no display is available.
 */
export function restoreWindowRect(
  stored: StoredWindowState,
  workAreas: readonly WindowRect[],
  minWidth: number,
  minHeight: number,
): WindowRect | null {
  if (workAreas.length === 0) {
    return null;
  }
  const bounds: WindowRect = stored.bounds;
  const target: WindowRect = targetWorkArea(bounds, workAreas);
  const width: number = clamp(Math.round(bounds.width), minWidth, Math.max(target.width, minWidth));
  const height: number = clamp(
    Math.round(bounds.height),
    minHeight,
    Math.max(target.height, minHeight),
  );
  if (workAreas.some((area: WindowRect): boolean => titleStripVisible(bounds, area))) {
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height };
  }
  return {
    x: Math.round(target.x + (target.width - width) / 2),
    y: Math.round(target.y + (target.height - height) / 2),
    width,
    height,
  };
}

/**
 * Determines whether a value is a finite number.
 * @param value The value to test.
 * @returns Returns true when the value is a finite number.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Clamps a value between a minimum and maximum.
 * @param value The value to clamp.
 * @param min The lower bound.
 * @param max The upper bound.
 * @returns Returns the clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes the overlap length of two one-dimensional intervals.
 * @param startA The first interval's start.
 * @param endA The first interval's end.
 * @param startB The second interval's start.
 * @param endB The second interval's end.
 * @returns Returns the overlap length, or zero when the intervals are disjoint.
 */
function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

/**
 * Determines whether enough of a window's title strip lies within a display's work area for the
 * window to be grabbed there.
 * @param bounds The window bounds.
 * @param area The display work area.
 * @returns Returns true when the title strip is sufficiently visible in the area.
 */
function titleStripVisible(bounds: WindowRect, area: WindowRect): boolean {
  const visibleWidth: number = overlap(
    bounds.x,
    bounds.x + bounds.width,
    area.x,
    area.x + area.width,
  );
  const visibleStrip: number = overlap(
    bounds.y,
    bounds.y + TITLE_STRIP_HEIGHT,
    area.y,
    area.y + area.height,
  );
  return visibleWidth >= MIN_VISIBLE_WIDTH && visibleStrip >= MIN_VISIBLE_STRIP_HEIGHT;
}

/**
 * Chooses the work area a window belongs to: the one it overlaps most by area, falling back to the
 * first (primary) display when it overlaps none.
 * @param bounds The window bounds.
 * @param workAreas The work areas of the connected displays, primary first.
 * @returns Returns the chosen work area.
 */
function targetWorkArea(bounds: WindowRect, workAreas: readonly WindowRect[]): WindowRect {
  let best: WindowRect = workAreas[0];
  let bestArea: number = 0;
  for (const area of workAreas) {
    const overlapArea: number =
      overlap(bounds.x, bounds.x + bounds.width, area.x, area.x + area.width) *
      overlap(bounds.y, bounds.y + bounds.height, area.y, area.y + area.height);
    if (overlapArea > bestArea) {
      best = area;
      bestArea = overlapArea;
    }
  }
  return best;
}
