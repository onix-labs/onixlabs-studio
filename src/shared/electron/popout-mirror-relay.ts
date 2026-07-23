import { BrowserWindow, ipcMain, IpcMainEvent, WebContents } from 'electron';
import { TerminalMirrorChannel } from '@shared/api/terminal-mirror-channels';
import { WindowManager } from './window-manager';

/**
 * Relays the terminal-mirror protocol between the main window (the owner of the terminal sessions)
 * and pop-out windows (viewers of them). Windows cannot address each other directly, so the relay
 * forwards: a pop-out's readiness and strip actions to the main window (stamped with the pop-out's
 * identifier), and the owner's published state to the pop-out it names. Only the main window may
 * publish, and only registered pop-outs may announce or act — anything else is dropped.
 */
export class PopoutMirrorRelay {
  /**
   * Holds the window manager the relay resolves windows through.
   */
  private readonly windows: WindowManager;

  /**
   * Initializes a new instance of the {@link PopoutMirrorRelay} class.
   * @param windows The window manager to resolve windows through.
   */
  public constructor(windows: WindowManager) {
    this.windows = windows;
  }

  /**
   * Registers the relay's IPC handlers.
   */
  public register(): void {
    ipcMain.on(TerminalMirrorChannel.Ready, (event: IpcMainEvent): void => {
      const popoutId: number | null = this.windows.idForWebContents(event.sender);
      if (popoutId === null || this.windows.popoutWebContents(popoutId) === null) {
        return;
      }
      this.sendToMain(TerminalMirrorChannel.Ready, popoutId);
    });

    ipcMain.on(
      TerminalMirrorChannel.Publish,
      (event: IpcMainEvent, popoutId: unknown, state: unknown): void => {
        // Only the owner publishes: state from any other window is discarded.
        if (!this.isMainWindow(event.sender)) {
          return;
        }
        if (typeof popoutId !== 'number' || typeof state !== 'object' || state === null) {
          return;
        }
        this.windows.popoutWebContents(popoutId)?.send(TerminalMirrorChannel.State, state);
      },
    );

    ipcMain.on(TerminalMirrorChannel.Action, (event: IpcMainEvent, action: unknown): void => {
      const popoutId: number | null = this.windows.idForWebContents(event.sender);
      if (popoutId === null || this.windows.popoutWebContents(popoutId) === null) {
        return;
      }
      if (typeof action !== 'object' || action === null) {
        return;
      }
      this.sendToMain(TerminalMirrorChannel.Action, popoutId, action);
    });
  }

  /**
   * Determines whether the given web contents belong to the main window.
   * @param contents The web contents to test.
   * @returns Returns true when the contents are the main window's.
   */
  private isMainWindow(contents: WebContents): boolean {
    const main: BrowserWindow | null = this.windows.main();
    return main !== null && !main.isDestroyed() && main.webContents === contents;
  }

  /**
   * Sends a message to the main window, if one is alive.
   * @param channel The IPC channel to send on.
   * @param args The arguments to send.
   */
  private sendToMain(channel: TerminalMirrorChannel, ...args: readonly unknown[]): void {
    const main: BrowserWindow | null = this.windows.main();
    if (main !== null && !main.isDestroyed()) {
      main.webContents.send(channel, ...args);
    }
  }
}
