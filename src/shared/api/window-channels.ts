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

  /**
   * Shows the requesting window, which the shell does once it has something to show
   * (renderer→main, send).
   */
  Show = 'window:show',

  /**
   * Hides the requesting window without closing it, which the shell does while the welcome screen
   * stands in for it (renderer→main, send).
   */
  Hide = 'window:hide',
}

/**
 * Names the exact URL an auxiliary panel window is opened with — one of the two `window.open`
 * targets the security guards allow. An auxiliary window shares the opener's renderer process, so
 * the opener builds its DOM directly and a dock panel renders into it with the workspace's own
 * services; the sentinel fragment keeps the allow surgically narrow (#116: everything else is still
 * denied and routed to the system browser).
 */
export const AUX_PANEL_URL: string = 'about:blank#studio-panel';

/**
 * Names the exact URL a modal window is opened with — the second allowed `window.open` target,
 * distinct from {@link AUX_PANEL_URL} so the main process can give it dialog chrome and parent it to
 * the window that raised it. A modal window is the same kind of same-renderer child: the opener
 * builds its DOM and renders the dialog's content into it, with the modal's own window-scoped
 * injector so overlays raised inside it land in ITS window.
 */
export const MODAL_WINDOW_URL: string = 'about:blank#studio-modal';

/**
 * Names the `window.open` feature that asks for a free-standing modal window — one with no parent.
 * Set only by the welcome screen's cold start, where the main window is hidden and a child of a
 * hidden parent would not be displayed at all on macOS.
 */
export const MODAL_UNPARENTED_FEATURE: string = 'studio-unparented';
