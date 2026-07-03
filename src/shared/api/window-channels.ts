/**
 * Names the window-control IPC channels: the custom title-bar's minimize/maximize/close/move-lock
 * operations. This is the window capability's slice of the IPC contract: the shared window client and
 * the main-process handler name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. All four are fire-and-forget (renderer→main, send).
 */
export enum WindowChannel {
  /**
   * Minimizes the application window.
   */
  Minimize = 'window:minimize',

  /**
   * Toggles the application window between its maximized and restored states.
   */
  ToggleMaximize = 'window:toggle-maximize',

  /**
   * Closes the application window.
   */
  Close = 'window:close',

  /**
   * Sets whether the application window may be moved by dragging its draggable regions.
   */
  SetMovable = 'window:set-movable',
}
