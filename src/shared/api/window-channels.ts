/**
 * Names the window IPC channels: the custom title-bar's control operations, which act on the
 * requesting window. The shared window client and the main-process handlers name their channels
 * from here, over the generic {@link import('./bridge').Bridge} transport.
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
}

/**
 * Names the exact URL an auxiliary panel window is opened with — the ONE `window.open` target the
 * security guards allow. An auxiliary window shares the opener's renderer process, so the opener
 * builds its DOM directly and a dock panel renders into it with the workspace's own services; the
 * sentinel fragment keeps the allow surgically narrow (#116: everything else is still denied and
 * routed to the system browser).
 */
export const AUX_PANEL_URL: string = 'about:blank#studio-panel';
