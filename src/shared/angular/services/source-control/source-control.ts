import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  RepositoryCapabilities,
  RepositoryInfo,
  SourceControlChannel,
  SourceControlClient,
  VersionControlPluginInfo,
} from '@shared/api/source-control-channels';
import type {
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { Log } from '@shared/angular/services/log/log';

/**
 * Builds a {@link SourceControlClient} that forwards each call to its {@link SourceControlChannel} over
 * the generic transport. Kept as a free function so the client is assembled from a non-null bridge,
 * without per-call presence checks.
 * @param bridge The generic transport to forward over.
 * @returns Returns the client bound to the bridge.
 */
function createClient(bridge: Bridge): SourceControlClient {
  return {
    resolveRepository: (directory: string): Promise<RepositoryInfo | null> =>
      bridge.invoke(SourceControlChannel.ResolveRepository, directory),
    closeRepository: (root: string): Promise<void> =>
      bridge.invoke(SourceControlChannel.CloseRepository, root),
    request: <Op extends VersionControlOp>(
      root: string,
      op: Op,
      params: VcsParams<Op>,
    ): Promise<VersionControlResponse<Op>> =>
      bridge.invoke(SourceControlChannel.Request, root, op, params),
    describe: (root: string): Promise<RepositoryCapabilities | null> =>
      bridge.invoke(SourceControlChannel.Describe, root),
    listPlugins: (): Promise<readonly VersionControlPluginInfo[]> =>
      bridge.invoke(SourceControlChannel.ListPlugins),
    setExecutable: (
      pluginId: string,
      executable: VersionControlExecutableChoice | null,
    ): Promise<VersionControlPluginInfo | null> =>
      bridge.invoke(SourceControlChannel.SetExecutable, pluginId, executable),
  };
}

/**
 * Represents the renderer-side client for the version-control capability. It wraps the generic
 * {@link Bridge} transport, exposing the typed {@link SourceControlClient} operations under
 * {@link SourceControl.client}.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the bridge
 * is absent and {@link SourceControl.client} is undefined, so consumers render their empty/unavailable
 * state.
 */
@Service()
export class SourceControl {
  /**
   * Gets the version-control operations, or undefined when running outside Electron.
   */
  public readonly client: SourceControlClient | undefined = window.bridge
    ? createClient(window.bridge)
    : undefined;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initialises a new instance of the {@link SourceControl} class, recording whether the source-control
   * bridge is available in the current environment.
   */
  public constructor() {
    this.log.debug(
      'SourceControl',
      `Source-control client ${this.client === undefined ? 'unavailable' : 'ready'}`,
    );
  }
}
