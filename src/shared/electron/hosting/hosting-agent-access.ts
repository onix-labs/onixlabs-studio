import {
  HostedRepositoryRef,
  HostingCapability,
  HostingOp,
  HostingParams,
  HostingResponse,
} from '@shared/api/hosting-protocol';
import { VcsRemote, VersionControlResponse } from '@shared/api/version-control-protocol';
import { logger } from '../logger';
import { OpenedRepository, VersionControlHost } from '../version-control/version-control-host';
import { HostedRepositoryDescription, HostingHost } from './hosting-host';
import { HostingCaller } from './hosting-write-gate';

/**
 * The remotes tried first, in order, when choosing which one names a run's repository on its host —
 * the same preference the source-control panels use, so an agent and the panels agree on which
 * repository "this" one is.
 */
const PREFERRED_REMOTES: readonly string[] = ['origin', 'upstream'];

/**
 * Describes the hosted repository an agent run works in, and what may be done there.
 */
export interface RunHosting {
  /**
   * Gets the id of the plugin serving the repository's host.
   */
  readonly pluginId: string;

  /**
   * Gets the plugin's display name, such as `GitHub`.
   */
  readonly provider: string;

  /**
   * Gets the repository.
   */
  readonly repository: HostedRepositoryRef;

  /**
   * Gets what the plugin can do *and* the repository allows — what the run is offered.
   */
  readonly capabilities: readonly HostingCapability[];
}

/**
 * Gives agent runs the installed hosting plugins (#852): finds the hosted repository a run works in,
 * and carries every request a run's tools make to the hosting host.
 *
 * ⚠️ This is the one path from an agent to a hosting plugin. Every call goes through
 * {@link HostingHost.requestFor} with the run's caller, so the host's checks — the plugin serves the
 * host, the repository allows the operation, an agent's write passes the run's posture — apply to all
 * of them. A future message bus (#847) replaces this path, not the tools.
 */
export class HostingAgentAccess {
  /**
   * Initializes the access.
   * @param hosting The hosting host.
   * @param versionControl The version-control host, which reads the repository's remotes.
   */
  public constructor(
    private readonly hosting: HostingHost,
    private readonly versionControl: VersionControlHost,
  ) {}

  /**
   * Finds the hosted repository a run's workspace belongs to: its repository's remotes, the preferred
   * one an installed hosting plugin serves, and what that plugin and repository allow.
   * @param workspaceRoot The run's workspace root, already confined to the open roots.
   * @returns Returns the repository, or null when the workspace is in no repository an installed
   * hosting plugin serves.
   */
  public async resolve(workspaceRoot: string | null): Promise<RunHosting | null> {
    if (workspaceRoot === null) {
      return null;
    }
    const remotes: readonly VcsRemote[] = await this.remotesOf(workspaceRoot);
    for (const remote of orderRemotes(remotes)) {
      const detected: ReturnType<HostingHost['detect']> = this.hosting.detect(remote.url);
      if (!detected?.plugin.resolve().available) {
        continue;
      }
      const described: HostedRepositoryDescription = await this.hosting.describeRepository(
        detected.repository,
      );
      if (!described.ok) {
        logger.debug(
          'HostingAgentAccess',
          `${detected.repository.owner}/${detected.repository.name}: ${described.error}`,
        );
        continue;
      }
      logger.debug(
        'HostingAgentAccess',
        `Run in ${workspaceRoot} works in ${detected.repository.host}/${detected.repository.owner}/${detected.repository.name} (${described.capabilities.join(', ')})`,
      );
      return {
        pluginId: described.pluginId,
        provider: described.displayName,
        repository: detected.repository,
        capabilities: described.capabilities,
      };
    }
    return null;
  }

  /**
   * Sends one of a run's requests to the plugin serving its repository.
   * @param run The run's repository.
   * @param op The operation.
   * @param params Its parameters.
   * @param caller The run, as the host's write gate sees it.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public request<Op extends HostingOp>(
    run: RunHosting,
    op: Op,
    params: HostingParams<Op>,
    caller: HostingCaller,
  ): Promise<HostingResponse<Op>> {
    return this.hosting.requestFor(run.pluginId, op, params, caller);
  }

  /**
   * Reads the remotes of the repository a folder is in. The repository is opened only for as long as
   * the read takes, so a run does not hold it open.
   * @param folder The folder.
   * @returns Returns the remotes, or none when the folder is in no repository a plugin reads.
   */
  private async remotesOf(folder: string): Promise<readonly VcsRemote[]> {
    const opened: OpenedRepository | null = await this.versionControl.openRepository(folder);
    if (opened === null) {
      return [];
    }
    try {
      const refs: VersionControlResponse<'refs'> = await this.versionControl.request(
        opened.root,
        'refs',
        {},
      );
      return refs.ok ? refs.result.remotes : [];
    } finally {
      this.versionControl.closeRepository(opened.root);
    }
  }
}

/**
 * Orders remotes for choosing the one that names the repository: the preferred names first, in
 * preference order, then the rest as the repository lists them.
 * @param remotes The remotes.
 * @returns Returns them in the order to try.
 */
export function orderRemotes(remotes: readonly VcsRemote[]): readonly VcsRemote[] {
  const rank: (remote: VcsRemote) => number = (remote: VcsRemote): number => {
    const index: number = PREFERRED_REMOTES.indexOf(remote.name);
    return index === -1 ? PREFERRED_REMOTES.length : index;
  };
  return [...remotes].sort((a: VcsRemote, b: VcsRemote): number => rank(a) - rank(b));
}
