import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { RepositoryInfo, SourceControlChannel } from '@shared/api/source-control-channels';
import {
  VCS_REPOSITORY_OPS,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { logger } from '../logger';
import { OpenedRepository, VersionControlHost } from './version-control-host';

/**
 * Serves the renderer's source-control client (#816): opening and closing repositories, and passing
 * its requests to the version-control host.
 *
 * The renderer is untrusted, so only the shape is checked here — an operation the renderer may send,
 * a root that is a string, parameters that are an object. Everything about *whether* a request may
 * proceed (an open root, a supported capability) is the host's, and everything about its parameters'
 * contents is the plugin's, which validates them as untrusted input.
 */
export class VersionControlManager {
  /**
   * Holds the host requests are passed to.
   */
  private readonly host: VersionControlHost;

  /**
   * Initializes the manager.
   * @param host The version-control host.
   */
  public constructor(host: VersionControlHost) {
    this.host = host;
  }

  /**
   * Registers the source-control IPC handlers.
   */
  public register(): void {
    logger.info('VersionControlManager', 'Registering source-control IPC handlers');
    ipcMain.handle(
      SourceControlChannel.ResolveRepository,
      (_event: IpcMainInvokeEvent, directory: unknown): Promise<RepositoryInfo | null> =>
        this.resolveRepository(directory),
    );
    ipcMain.handle(
      SourceControlChannel.CloseRepository,
      (_event: IpcMainInvokeEvent, root: unknown): void => this.host.closeRepository(root),
    );
    ipcMain.handle(
      SourceControlChannel.Request,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        op: unknown,
        params: unknown,
      ): Promise<VersionControlResponse> => this.request(root, op, params),
    );
  }

  /**
   * Stops every running version-control plugin.
   */
  public dispose(): void {
    this.host.dispose();
  }

  /**
   * Opens the repository containing a folder.
   * @param directory The folder, untrusted.
   * @returns Returns the repository, or null when the folder is in none.
   */
  private async resolveRepository(directory: unknown): Promise<RepositoryInfo | null> {
    const opened: OpenedRepository | null = await this.host.openRepository(directory);
    return opened === null ? null : { root: opened.root, name: opened.name };
  }

  /**
   * Passes a renderer request to the host after checking its shape.
   * @param root The repository root, untrusted.
   * @param op The operation, untrusted.
   * @param params The parameters, untrusted.
   * @returns Returns the answer, or a refusal of a malformed request.
   */
  private request(root: unknown, op: unknown, params: unknown): Promise<VersionControlResponse> {
    if (
      typeof root !== 'string' ||
      typeof op !== 'string' ||
      !(VCS_REPOSITORY_OPS as readonly string[]).includes(op) ||
      typeof params !== 'object' ||
      params === null
    ) {
      logger.warn('VersionControlManager', 'Refused a malformed source-control request');
      return Promise.resolve({
        id: 0,
        ok: false,
        error: 'Malformed source-control request.',
        code: 'refused',
      });
    }
    return this.host.request(root, op as VersionControlOp, params as VcsParams<VersionControlOp>);
  }
}
