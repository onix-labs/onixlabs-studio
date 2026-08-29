import { ipcMain, IpcMainInvokeEvent, shell } from 'electron';
import {
  WorkspaceKind,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeChannel } from '@shared/api/worktree-channels';
import { logger } from '../logger';
import { TrustedPaths } from '../trusted-paths';
import { WorkspaceContext } from '../workspace-context';
import { WorktreeOperations } from './worktree-operations';

/**
 * Exposes the worktree-container operations to the renderer over IPC. The disk and git mechanics
 * live in the Electron-free {@link WorktreeOperations} (kept unit-testable); this wrapper binds them
 * to the IPC channels and supplies the one genuinely Electron-bound piece — sending a removed
 * checkout's directory to the OS trash rather than deleting it.
 */
export class WorktreeManager {
  /**
   * Holds the worktree disk operations.
   */
  private readonly operations: WorktreeOperations;

  /**
   * Initializes a new instance of the {@link WorktreeManager} class.
   * @param workspace The shared workspace context, used to confine every operation to open roots.
   * @param trusted The trusted-paths store, used to gate kind resolution for not-yet-open folders.
   */
  public constructor(workspace: WorkspaceContext, trusted: TrustedPaths) {
    this.operations = new WorktreeOperations(workspace, trusted, (target: string): Promise<void> =>
      shell.trashItem(target),
    );
  }

  /**
   * Registers the worktree IPC handlers. Confinement lives in the operations themselves: kind
   * resolution honours only trusted or open paths, and every container operation requires an open
   * workspace root.
   */
  public register(): void {
    logger.info('WorktreeManager', 'Registering worktree IPC handlers');
    ipcMain.handle(
      WorktreeChannel.Resolve,
      (_event: IpcMainInvokeEvent, target: unknown): Promise<WorkspaceKind | null> => {
        logger.trace('WorktreeManager', `Resolve kind for ${String(target)}`);
        return this.operations.resolveKind(target);
      },
    );
    ipcMain.handle(
      WorktreeChannel.Describe,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<WorktreeDescriptor | null> => {
        logger.trace('WorktreeManager', `Describe ${String(root)}`);
        return this.operations.describe(root);
      },
    );
    ipcMain.handle(
      WorktreeChannel.Promote,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<WorktreeOutcome<WorktreeDescriptor>> => {
        logger.trace('WorktreeManager', `Promote ${String(root)}`);
        return this.logged(`Promote ${String(root)}`, this.operations.promote(root));
      },
    );
    ipcMain.handle(
      WorktreeChannel.AddCheckout,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        options: unknown,
      ): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> => {
        logger.trace('WorktreeManager', `Add checkout in ${String(root)}`);
        return this.logged(
          `Add checkout in ${String(root)}`,
          this.operations.addCheckout(root, options),
        );
      },
    );
    ipcMain.handle(
      WorktreeChannel.RemoveCheckout,
      (_event: IpcMainInvokeEvent, root: unknown, id: unknown): Promise<WorktreeOutcome<null>> => {
        logger.trace('WorktreeManager', `Remove checkout ${String(id)} in ${String(root)}`);
        return this.logged(
          `Remove checkout ${String(id)}`,
          this.operations.removeCheckout(root, id),
        );
      },
    );
    ipcMain.handle(
      WorktreeChannel.OpenCheckout,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        id: unknown,
      ): Promise<WorktreeOutcome<string>> => {
        logger.trace('WorktreeManager', `Open checkout ${String(id)} in ${String(root)}`);
        return this.operations.openCheckout(root, id);
      },
    );
    ipcMain.handle(
      WorktreeChannel.Status,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
      ): Promise<readonly WorktreeCheckoutStatus[] | null> => {
        logger.trace('WorktreeManager', `Status for ${String(root)}`);
        return this.operations.status(root);
      },
    );
    ipcMain.handle(
      WorktreeChannel.Branches,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<readonly string[] | null> => {
        logger.trace('WorktreeManager', `Branches for ${String(root)}`);
        return this.operations.branches(root);
      },
    );
  }

  /**
   * Logs a mutating worktree operation's outcome: an info on success, an error (with the reason) on
   * failure. The disk mechanics stay Electron-free in {@link WorktreeOperations}; this wrapper owns
   * the logging.
   * @param action A human-readable description of the operation.
   * @param outcome The operation's promised outcome.
   * @returns Returns the same outcome, for the handler to reply with.
   */
  private async logged<T>(
    action: string,
    outcome: Promise<WorktreeOutcome<T>>,
  ): Promise<WorktreeOutcome<T>> {
    const result: WorktreeOutcome<T> = await outcome;
    if (result.ok) {
      logger.info('WorktreeManager', `${action} succeeded`);
    } else {
      logger.error('WorktreeManager', `${action} failed: ${result.error}`);
    }
    return result;
  }
}
