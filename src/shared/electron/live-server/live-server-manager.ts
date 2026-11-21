import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  LiveServerAvailability,
  LiveServerChannel,
  LiveServerInfo,
  LiveServerOpenAnswer,
} from '@shared/api/live-server-channels';
import { logger } from '../logger';
import { LiveServerHost } from './live-server-host';

/**
 * Serves the explorers' and the status chip's live-server requests (#1062), passing each to the host.
 *
 * The renderer is untrusted, but every argument is handed on as `unknown`: the host checks each one — an
 * absolute HTML file, inside an open workspace, its links included — before the plugin hears of it.
 */
export class LiveServerManager {
  /**
   * Holds the host requests are passed to.
   */
  private readonly host: LiveServerHost;

  /**
   * Initializes the manager.
   * @param host The live-server host.
   */
  public constructor(host: LiveServerHost) {
    this.host = host;
  }

  /**
   * Registers the live-server IPC handlers.
   */
  public register(): void {
    logger.info('LiveServerManager', 'Registering live-server IPC handlers');
    ipcMain.handle(LiveServerChannel.Availability, (): LiveServerAvailability =>
      this.host.availability(),
    );
    ipcMain.handle(
      LiveServerChannel.Open,
      (_event: IpcMainInvokeEvent, file: unknown): Promise<LiveServerOpenAnswer> =>
        this.host.open(file),
    );
    ipcMain.handle(
      LiveServerChannel.Stop,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<void> => this.host.stop(root),
    );
    ipcMain.handle(LiveServerChannel.List, (): readonly LiveServerInfo[] => this.host.list());
  }

  /**
   * Stops the live-server plugin, closing every port it held.
   */
  public dispose(): void {
    this.host.dispose();
  }
}
