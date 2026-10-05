import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  DetectedRepository,
  RepositoryCapabilities,
  RepositoryInfo,
  SourceControlChannel,
  VersionControlPluginInfo,
} from '@shared/api/source-control-channels';
import {
  VCS_REPOSITORY_OPS,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { logger } from '../logger';
import { VersionControlDescriptor } from './version-control-descriptor';
import { OpenedRepository, PluginDescription, VersionControlHost } from './version-control-host';
import { readExecutableChoice, VersionControlSettings } from './version-control-settings';

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
   * Holds which tool each plugin runs.
   */
  private readonly settings: VersionControlSettings;

  /**
   * Initializes the manager.
   * @param host The version-control host.
   * @param settings Which tool each plugin runs.
   */
  public constructor(host: VersionControlHost, settings: VersionControlSettings) {
    this.host = host;
    this.settings = settings;
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
    ipcMain.handle(
      SourceControlChannel.Describe,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<RepositoryCapabilities | null> =>
        this.describe(root),
    );
    ipcMain.handle(
      SourceControlChannel.Detect,
      (_event: IpcMainInvokeEvent, directory: unknown): DetectedRepository | null => {
        const descriptor: VersionControlDescriptor | null = this.host.detect(directory);
        return descriptor === null
          ? null
          : {
              pluginId: descriptor.id,
              displayName: descriptor.displayName,
              installed: descriptor.resolve().available,
            };
      },
    );
    ipcMain.handle(
      SourceControlChannel.ListPlugins,
      (): Promise<readonly VersionControlPluginInfo[]> => this.listPlugins(),
    );
    ipcMain.handle(
      SourceControlChannel.SetExecutable,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        executable: unknown,
      ): Promise<VersionControlPluginInfo | null> => this.setExecutable(pluginId, executable),
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
   * Gets what the plugin serving an opened repository can do.
   * @param root The repository root, untrusted.
   * @returns Returns the capabilities, or null when no plugin can be asked.
   */
  private async describe(root: unknown): Promise<RepositoryCapabilities | null> {
    if (typeof root !== 'string') {
      return null;
    }
    const described: PluginDescription = await this.host.describe(root);
    if (!described.ok) {
      return null;
    }
    return {
      pluginId: described.pluginId,
      displayName: this.host.descriptor(described.pluginId)?.displayName ?? described.pluginId,
      capabilities: described.capabilities,
    };
  }

  /**
   * Lists every contributed plugin with its configuration, starting the installed ones so each can
   * report its tool's version.
   * @returns Returns the plugins.
   */
  private async listPlugins(): Promise<readonly VersionControlPluginInfo[]> {
    const plugins: VersionControlPluginInfo[] = [];
    for (const descriptor of this.host.preferredOrder()) {
      plugins.push(await this.info(descriptor));
    }
    return plugins;
  }

  /**
   * Sets which tool a plugin runs, refusing a mode its manifest does not offer.
   * @param pluginId The plugin, untrusted.
   * @param executable The choice, untrusted; null returns to the default.
   * @returns Returns the plugin as configured afterwards, or null when the choice was refused.
   */
  private async setExecutable(
    pluginId: unknown,
    executable: unknown,
  ): Promise<VersionControlPluginInfo | null> {
    const descriptor: VersionControlDescriptor | undefined =
      typeof pluginId === 'string' ? this.host.descriptor(pluginId) : undefined;
    if (descriptor === undefined) {
      return null;
    }
    if (executable !== null) {
      const choice: VersionControlExecutableChoice | null = readExecutableChoice(executable);
      if (choice === null || !descriptor.executableModes.includes(choice.mode)) {
        logger.warn('VersionControlManager', `Refused an executable choice for ${descriptor.id}`);
        return null;
      }
      this.settings.setExecutable(descriptor.id, choice);
    } else {
      this.settings.setExecutable(descriptor.id, null);
    }
    this.host.restartPlugin(descriptor.id);
    return this.info(descriptor);
  }

  /**
   * Describes one plugin for Settings.
   * @param descriptor The plugin.
   * @returns Returns its information.
   */
  private async info(descriptor: VersionControlDescriptor): Promise<VersionControlPluginInfo> {
    const installed: boolean = descriptor.resolve().available;
    const described: PluginDescription | null = installed
      ? await this.host.describePlugin(descriptor.id)
      : null;
    const problem: string | undefined =
      described === null
        ? undefined
        : described.ok
          ? described.description.problem
          : described.error;
    return {
      id: descriptor.id,
      displayName: descriptor.displayName,
      installed,
      executableModes: descriptor.executableModes,
      executable: this.settings.executableFor(descriptor.id),
      toolVersion: described?.ok === true ? described.description.toolVersion : null,
      ...(problem === undefined ? {} : { problem }),
    };
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
