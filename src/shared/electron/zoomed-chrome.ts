/**
 * Holds the height, in CSS pixels, of the title strip the platform's window controls sit in: the
 * main window's strip, and the drag strip along the top of a modal window, both about this tall.
 */
const TITLE_STRIP_HEIGHT: number = 40;

/**
 * Holds how far, in screen pixels, the macOS traffic lights sit from the window's leading edge. It
 * does not change with the zoom: the strip leaves room for them in screen pixels too.
 */
const TRAFFIC_LIGHT_INSET: number = 14;

/**
 * Holds how far, in screen pixels, the macOS traffic lights sit from the window's top edge at 100%,
 * which centres them in the title strip.
 */
const TRAFFIC_LIGHT_TOP: number = 14;

/**
 * Describes where the macOS traffic lights are drawn, in screen pixels from the window's top-leading
 * corner (Electron's `Point`).
 */
export interface TrafficLightPosition {
  /**
   * Gets the distance from the window's leading edge.
   */
  readonly x: number;

  /**
   * Gets the distance from the window's top edge.
   */
  readonly y: number;
}

/**
 * Works out where the macOS traffic lights sit at a zoom factor: as far in from the leading edge as
 * always, and moved down or up so they stay centred in the title strip, which is drawn taller or
 * shorter by the zoom. Their own size never changes, so their centre moves by half the strip's
 * change in height.
 * @param factor The zoom factor the window is drawn at.
 * @returns Returns the traffic lights' position.
 */
export function trafficLightPositionAt(factor: number): TrafficLightPosition {
  const growth: number = TITLE_STRIP_HEIGHT * (factor - 1);
  return { x: TRAFFIC_LIGHT_INSET, y: Math.max(0, Math.round(TRAFFIC_LIGHT_TOP + growth / 2)) };
}

/**
 * Works out the height of the Windows caption-button overlay at a zoom factor: the title strip's
 * height in screen pixels, so the buttons fill it top to bottom as they would a native title bar.
 * @param factor The zoom factor the window is drawn at.
 * @returns Returns the overlay's height, in screen pixels.
 */
export function overlayHeightAt(factor: number): number {
  return Math.round(TITLE_STRIP_HEIGHT * factor);
}
