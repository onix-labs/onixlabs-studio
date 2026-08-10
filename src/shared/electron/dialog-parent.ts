import {
  BrowserWindow,
  dialog,
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  WebContents,
} from 'electron';
import { logger } from './logger';

/**
 * Resolves the window a native dialog should be parented to.
 *
 * A dialog is only ever parented to a window that is ON SCREEN. On macOS a parented dialog is a
 * sheet, and attaching a sheet to a hidden window orders that window front to carry it — so a hidden
 * parent does not merely misplace the dialog, it reveals an empty window over whatever the user was
 * actually looking at, and leaves it there once the dialog closes.
 *
 * That is not a corner case here. Child windows (the welcome screen, modals, pop-outs) render in
 * their own window but their components live in the main window's renderer, so the request arrives
 * from the MAIN window — which at a cold start is hidden, with the welcome window standing in for it.
 * Trusting the requester therefore shows the blank main window every time.
 *
 * The requesting window is preferred while it is visible, because it is the most specific answer and
 * is correct for every ordinary window. Otherwise the focused window is used: when the request comes
 * from a hidden renderer on behalf of a child window, the focused window IS that child window — the
 * one the user clicked in. A visible main window is the last resort.
 * @param sender The web contents that requested the dialog.
 * @param fallback Returns the main application window, used when nothing better is on screen.
 * @returns Returns the window to parent the dialog to, or null when no window is on screen.
 */
export function resolveDialogParent(
  sender: WebContents,
  fallback: () => BrowserWindow | null = (): null => null,
): BrowserWindow | null {
  const requester: BrowserWindow | null = BrowserWindow.fromWebContents(sender);
  if (onScreen(requester)) {
    return requester;
  }
  const focused: BrowserWindow | null = BrowserWindow.getFocusedWindow();
  if (onScreen(focused)) {
    return focused;
  }
  const main: BrowserWindow | null = fallback();
  return onScreen(main) ? main : null;
}

/**
 * Shows an open dialog parented to the window resolved by {@link resolveDialogParent}. With no window
 * on screen the dialog is shown application-modally rather than suppressed: a dialog the user asked
 * for must appear, and an unparented dialog is always preferable to none.
 * @param sender The web contents that requested the dialog.
 * @param fallback Returns the main application window, used when nothing better is on screen.
 * @param options The dialog options.
 * @returns Returns the dialog result.
 */
export function showOpenDialog(
  sender: WebContents,
  fallback: (() => BrowserWindow | null) | undefined,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const parent: BrowserWindow | null = resolveDialogParent(sender, fallback);
  logger.trace('dialog-parent', `Showing open dialog (parented: ${parent !== null})`);
  return parent === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(parent, options);
}

/**
 * Shows a save dialog parented to the window resolved by {@link resolveDialogParent}.
 * @param sender The web contents that requested the dialog.
 * @param fallback Returns the main application window, used when nothing better is on screen.
 * @param options The dialog options.
 * @returns Returns the dialog result.
 */
export function showSaveDialog(
  sender: WebContents,
  fallback: (() => BrowserWindow | null) | undefined,
  options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  const parent: BrowserWindow | null = resolveDialogParent(sender, fallback);
  logger.trace('dialog-parent', `Showing save dialog (parented: ${parent !== null})`);
  return parent === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(parent, options);
}

/**
 * Shows a message box parented to the window resolved by {@link resolveDialogParent}.
 * @param sender The web contents that requested the dialog.
 * @param fallback Returns the main application window, used when nothing better is on screen.
 * @param options The message box options.
 * @returns Returns the message box result.
 */
export function showMessageBox(
  sender: WebContents,
  fallback: (() => BrowserWindow | null) | undefined,
  options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
  const parent: BrowserWindow | null = resolveDialogParent(sender, fallback);
  logger.trace('dialog-parent', `Showing message box (parented: ${parent !== null})`);
  return parent === null ? dialog.showMessageBox(options) : dialog.showMessageBox(parent, options);
}

/**
 * Determines whether a window is alive and currently on screen.
 * @param window The window to test, which may be null.
 * @returns Returns true when the window exists, is not destroyed, and is visible.
 */
function onScreen(window: BrowserWindow | null): boolean {
  return window !== null && !window.isDestroyed() && window.isVisible();
}
