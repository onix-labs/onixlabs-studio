import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  TestAdapterInfo,
  TestChannel,
  TestDebugPlanAnswer,
  TestDiscoverAnswer,
  TestResultsAnswer,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import { logger } from '../logger';
import { TestAdapterHost } from './test-adapter-host';

/**
 * Serves the Tests panel's requests (#1351), passing each to the test-adapter host.
 *
 * The renderer is untrusted, but every argument is handed on as `unknown`: the host checks each one —
 * an open, trusted folder, an installed plugin, a run it planned — before any plugin hears of it.
 */
export class TestAdapterManager {
  /**
   * Holds the host requests are passed to.
   */
  private readonly host: TestAdapterHost;

  /**
   * Initializes the manager.
   * @param host The test-adapter host.
   */
  public constructor(host: TestAdapterHost) {
    this.host = host;
  }

  /**
   * Registers the test IPC handlers.
   */
  public register(): void {
    logger.info('TestAdapterManager', 'Registering test IPC handlers');
    ipcMain.handle(
      TestChannel.Adapters,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<readonly TestAdapterInfo[]> =>
        this.host.adaptersFor(root),
    );
    ipcMain.handle(
      TestChannel.Discover,
      (_event: IpcMainInvokeEvent, pluginId: unknown, root: unknown): Promise<TestDiscoverAnswer> =>
        this.host.discover(pluginId, root),
    );
    ipcMain.handle(
      TestChannel.PlanRun,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        root: unknown,
        ids: unknown,
      ): Promise<TestRunPlanAnswer> => this.host.planRun(pluginId, root, ids),
    );
    ipcMain.handle(
      TestChannel.Results,
      (
        _event: IpcMainInvokeEvent,
        runId: unknown,
        exitCode: unknown,
        transcript: unknown,
      ): Promise<TestResultsAnswer> => this.host.results(runId, exitCode, transcript),
    );
    ipcMain.handle(
      TestChannel.PlanDebug,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        root: unknown,
        id: unknown,
      ): Promise<TestDebugPlanAnswer> => this.host.planDebug(pluginId, root, id),
    );
    ipcMain.handle(
      TestChannel.Finish,
      (_event: IpcMainInvokeEvent, runId: unknown): Promise<void> => this.host.finish(runId),
    );
  }

  /**
   * Stops every running test-adapter plugin.
   */
  public dispose(): void {
    this.host.dispose();
  }
}
