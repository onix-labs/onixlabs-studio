import { logger } from './logger';

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
    logger.warn('WindowState.parse', 'persisted state has no bounds object; ignoring');
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
    logger.warn('WindowState.parse', 'persisted bounds are not finite/positive; ignoring');
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
    logger.warn('WindowState.restore', 'no displays available; cannot restore bounds');
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
    const rect: WindowRect = { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height };
    logger.debug('WindowState.restore', 'persisted bounds still grabbable; kept in place', rect);
    return rect;
  }
  const recentred: WindowRect = {
    x: Math.round(target.x + (target.width - width) / 2),
    y: Math.round(target.y + (target.height - height) / 2),
    width,
    height,
  };
  logger.warn('WindowState.restore', 'persisted bounds off-screen; re-centred on display', recentred);
  return recentred;
}

/**
 * Parses the position requested by a `window.open` features string (`left=…,top=…`), as a tear-out
 * drag passes it. Parsed defensively — the string is renderer-supplied — and only a complete,
 * finite pair is honoured.
 * @param features The raw features string from the window-open request.
 * @returns Returns the requested position, or null when the features carry no usable position.
 */
export function parseRequestedPosition(features: string): { x: number; y: number } | null {
  const entries: Map<string, number> = numericFeatures(features);
  const x: number | undefined = entries.get('left');
  const y: number | undefined = entries.get('top');
  return x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : null;
}

/**
 * Parses the size requested by a `window.open` features string (`width=…,height=…`), as a modal
 * window measured against its content passes it. Parsed defensively — the string is
 * renderer-supplied — and only a complete, finite, positive pair is honoured.
 * @param features The raw features string from the window-open request.
 * @returns Returns the requested size, or null when the features carry no usable size.
 */
export function parseRequestedSize(features: string): { width: number; height: number } | null {
  const entries: Map<string, number> = numericFeatures(features);
  const width: number | undefined = entries.get('width');
  const height: number | undefined = entries.get('height');
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Reads a named size from a `window.open` features string (for example `minwidth=…,minheight=…`).
 * Parsed defensively — the string is renderer-supplied — and only a complete, finite, positive pair
 * is honoured.
 * @param features The raw features string from the window-open request.
 * @param prefix The name prefix the pair is keyed under (`min` or `max`).
 * @returns Returns the size, or null when the features carry no usable pair.
 */
export function parseNamedSize(
  features: string,
  prefix: string,
): { width: number; height: number } | null {
  const entries: Map<string, number> = numericFeatures(features);
  const width: number | undefined = entries.get(`${prefix}width`);
  const height: number | undefined = entries.get(`${prefix}height`);
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Reads a boolean flag from a `window.open` features string, where the flag is set by `name=1` and
 * cleared by `name=0` (the DOM features convention). Anything else — an absent or unparsable flag —
 * yields the supplied fallback, so a malformed string can never produce a surprising window.
 * @param features The raw features string from the window-open request.
 * @param name The flag name to read.
 * @param fallback The value to use when the flag is absent or unparsable.
 * @returns Returns the flag's value.
 */
export function parseFeatureFlag(features: string, name: string, fallback: boolean): boolean {
  const value: number | undefined = numericFeatures(features).get(name.toLowerCase());
  return value === undefined ? fallback : value !== 0;
}

/**
 * Reads a text value from a `window.open` features string. Renderer-supplied, so the caller is
 * expected to validate the shape of what it gets.
 * @param features The raw features string from the window-open request.
 * @param name The entry name to read.
 * @returns Returns the value, or null when the features carry none.
 */
export function parseFeatureText(features: string, name: string): string | null {
  for (const part of features.split(',')) {
    const separator: number = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim().toLowerCase() === name.toLowerCase()) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/**
 * Parses a features string into its finite numeric entries, keyed by lower-cased name.
 * @param features The raw features string from the window-open request.
 * @returns Returns the numeric entries the string carries.
 */
function numericFeatures(features: string): Map<string, number> {
  const entries: Map<string, number> = new Map<string, number>();
  for (const part of features.split(',')) {
    const [key, raw] = part.split('=');
    const value: number = Number(raw);
    if (key !== undefined && raw !== undefined && Number.isFinite(value)) {
      entries.set(key.trim().toLowerCase(), value);
    }
  }
  return entries;
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
