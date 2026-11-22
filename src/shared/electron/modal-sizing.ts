/**
 * Describes a width and height, in whichever pixels the holder says.
 */
export interface PixelSize {
  /**
   * Gets the width.
   */
  readonly width: number;

  /**
   * Gets the height.
   */
  readonly height: number;
}

/**
 * Describes the size a modal window means to be, in CSS pixels, before anything held it to a display.
 *
 * A modal is held to the display it opens on, so at a large Interface Zoom it can end up smaller than
 * it asked for. Rescaling the size it ended up at would make that loss permanent: a welcome screen
 * held to a 1440×900 display at 200%, then taken back to 100%, would come back at half the display
 * rather than at its own size. So a zoom change works the window out again from these, times the new
 * zoom factor, and only then holds the result to the display.
 */
export interface ModalSizing {
  /**
   * Gets the window's size as asked for, in CSS pixels: by its opener, or by the user or the opener
   * resizing it since.
   */
  readonly size: PixelSize;

  /**
   * Gets the smallest the window may be, in CSS pixels.
   */
  readonly minimum: PixelSize;

  /**
   * Gets the largest the window may be, in CSS pixels, or null for no ceiling.
   */
  readonly maximum: PixelSize | null;

  /**
   * Gets the zoom factor the window was last sized for.
   */
  readonly zoom: number;

  /**
   * Gets the size, in screen pixels, the window manager itself last gave the window, so the resize
   * that follows is not taken for a size the window was asked to be.
   */
  readonly applied: PixelSize;
}
