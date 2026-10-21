/**
 * Names the window IPC channels: the window operations the shell drives itself, which act on the
 * requesting window. The shared window client and the main-process handlers name their channels
 * from here, over the generic {@link import('./bridge').Bridge} transport.
 *
 * The window-control channels (close, minimize, maximize) take an optional window name as their one
 * argument. A pop-out or modal window is a same-renderer child the opener scripts directly, so its
 * requests arrive from the opener; the name — the one it was opened with, see
 * {@link CHILD_WINDOW_NAME_PATTERN} — says which window is meant. Without one, the requesting window
 * is.
 */
export enum WindowChannel {
  /**
   * Closes the requesting window, or the named child window (renderer→main, send).
   */
  Close = 'window:close',

  /**
   * Minimizes the requesting window, or the named child window (renderer→main, send).
   */
  Minimize = 'window:minimize',

  /**
   * Toggles the requesting window, or the named child window, between its maximized and restored
   * states (renderer→main, send).
   */
  ToggleMaximize = 'window:toggle-maximize',

  /**
   * Reports whether the requesting window, or the named child window, is maximized
   * (renderer→main, invoke; resolves a boolean).
   */
  IsMaximized = 'window:is-maximized',

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

  /**
   * Sets the colour of the system caption-button glyphs that Windows draws over every window, so
   * they follow the application's theme rather than the system's (renderer→main, send). Ignored on
   * other platforms.
   */
  SetCaptionSymbolColor = 'window:set-caption-symbol-color',

  /**
   * Raises the requesting window's minimum size to what its dock layout needs, so no panel group is
   * ever crushed below its content (renderer→main, send; #1064). Never below the window's own floor,
   * and never above the screen it is on.
   */
  SetMinimumSize = 'window:set-minimum-size',
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

/**
 * Matches the name a pop-out or modal window is opened with: `studio-window-` and a UUID. The name is
 * the window's handle across the process boundary — the main process records each child under it
 * when the window is created, and the window-control channels name their target with it.
 */
export const CHILD_WINDOW_NAME_PATTERN: RegExp = /^studio-window-[0-9a-f-]{36}$/;

/**
 * Creates a fresh name for a pop-out or modal window to be opened with (see
 * {@link CHILD_WINDOW_NAME_PATTERN}).
 * @returns Returns the window name.
 */
export function childWindowName(): string {
  return `studio-window-${crypto.randomUUID()}`;
}
