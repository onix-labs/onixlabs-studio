/**
 * How large the whole interface is drawn, as a percentage (Settings › Application › Accessibility ›
 * Interface Zoom). A fixed set of levels rather than a free value: each one has been checked against
 * the tabs, ribbons, strips, docking and the title strip.
 */
export type InterfaceZoom = 75 | 80 | 100 | 125 | 150 | 200;

/**
 * Holds every Interface Zoom level, smallest first.
 */
export const INTERFACE_ZOOM_LEVELS: readonly InterfaceZoom[] = [75, 80, 100, 125, 150, 200];

/**
 * Holds the level the interface is drawn at until the user picks another.
 */
export const DEFAULT_INTERFACE_ZOOM: InterfaceZoom = 100;

/**
 * Reads an Interface Zoom level from an untrusted value (a persisted file, a renderer's message), so
 * a hand-edited or corrupt entry draws the interface at its default size rather than at some size no
 * one checked.
 * @param candidate The value to read.
 * @returns Returns the level when it is one of the fixed levels, otherwise the default.
 */
export function parseInterfaceZoom(candidate: unknown): InterfaceZoom {
  return (
    INTERFACE_ZOOM_LEVELS.find((level: InterfaceZoom): boolean => level === candidate) ??
    DEFAULT_INTERFACE_ZOOM
  );
}

/**
 * Turns an Interface Zoom level into the zoom factor Electron draws a window's web contents at: the
 * percentage as a fraction, so 125% is 1.25 and 75% is 0.75. Electron's zoom *level* is a logarithmic
 * scale (each step is 20%), which none of the levels sit on exactly, so the factor is what is set.
 * @param level The Interface Zoom level.
 * @returns Returns the zoom factor.
 */
export function zoomFactorOf(level: InterfaceZoom): number {
  return level / 100;
}

/**
 * Turns a stored Interface Zoom into the zoom factor, reading it as untrusted first. The main process
 * draws a value that is not one of the levels at 100%, so the renderer must reckon with the same
 * factor: an imported `250` or `"abc"` taken at face value would size windows and the room left for
 * the window controls for a zoom no window is drawn at.
 * @param raw The stored value.
 * @returns Returns the zoom factor (1 for anything that is not one of the levels).
 */
export function interfaceZoomFactor(raw: unknown): number {
  return zoomFactorOf(parseInterfaceZoom(raw));
}
