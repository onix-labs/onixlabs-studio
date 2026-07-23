/**
 * Names the window IPC channels: the custom title-bar's control operations (which act on the
 * requesting window) and the pop-out window lifecycle (which the main process owns — the renderer
 * can never open windows itself). The shared window client and the main-process handlers name their
 * channels from here, over the generic {@link import('./bridge').Bridge} transport.
 */
export enum WindowChannel {
  /**
   * Minimizes the requesting window (renderer→main, send).
   */
  Minimize = 'window:minimize',

  /**
   * Toggles the requesting window between its maximized and restored states (renderer→main, send).
   */
  ToggleMaximize = 'window:toggle-maximize',

  /**
   * Closes the requesting window (renderer→main, send).
   */
  Close = 'window:close',

  /**
   * Sets whether the requesting window may be moved by dragging its draggable regions
   * (renderer→main, send).
   */
  SetMovable = 'window:set-movable',

  /**
   * Sets whether the requesting window floats above every other window — the pop-out title-bar's
   * pin (renderer→main, send).
   */
  SetAlwaysOnTop = 'window:set-always-on-top',

  /**
   * Requests a new pop-out window carrying the given parameters, answering its window identifier —
   * or null when the parameters are rejected (renderer→main, invoke).
   */
  OpenPopout = 'window:open-popout',

  /**
   * Closes the pop-out window with the given identifier (renderer→main, invoke).
   */
  ClosePopout = 'window:close-popout',

  /**
   * Brings the pop-out window with the given identifier to the front, restoring it first when
   * minimized (renderer→main, invoke).
   */
  FocusPopout = 'window:focus-popout',

  /**
   * Notifies the main window that a pop-out window has closed, carrying its identifier
   * (main→renderer, send).
   */
  PopoutClosed = 'window:popout-closed',
}
