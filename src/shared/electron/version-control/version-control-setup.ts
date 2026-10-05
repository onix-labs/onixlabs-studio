import type { GitIdentity, SetupProbeResult, SetupProbeStatus } from '@shared/api/setup-channels';
import { VcsIdentity, VersionControlResponse } from '@shared/api/version-control-protocol';
import { VersionControlDescriptor } from './version-control-descriptor';
import { PluginDescription, VersionControlHost } from './version-control-host';

/**
 * What the setup wizard is told when no version-control plugin is installed.
 */
const NO_PLUGIN: string =
  'No version-control plugin is installed, so source control is unavailable. Install Git from the Plugin Manager.';

/**
 * Answers the setup wizard's version-control questions — is the tool there, which version, who are
 * commits attributed to — through the installed version-control plugin (#817).
 *
 * The wizard used to run `git` itself. Behind the seam it asks whichever plugin is installed, so a
 * machine with no plugin is told to install one rather than that git is missing, and a plugin pointed
 * at a custom git reports that git's version rather than the one on the PATH.
 */
export class VersionControlSetup {
  /**
   * Holds the version-control host.
   */
  private readonly host: VersionControlHost;

  /**
   * Initializes the setup bridge.
   * @param host The version-control host.
   */
  public constructor(host: VersionControlHost) {
    this.host = host;
  }

  /**
   * Probes the version-control tool and the committer identity, as the wizard's two source-control
   * rows. Their ids stay `git` and `git-identity` because that is what the wizard lists.
   * @returns Returns the two probe results.
   */
  public async probe(): Promise<readonly SetupProbeResult[]> {
    const plugin: VersionControlDescriptor | null = this.host.preferredPlugin();
    if (plugin === null) {
      return [
        { id: 'git', status: 'missing', detail: NO_PLUGIN },
        { id: 'git-identity', status: 'unknown', detail: 'Needs a version-control plugin.' },
      ];
    }
    const described: PluginDescription = await this.host.describePlugin(plugin.id);
    const tool: SetupProbeResult = !described.ok
      ? { id: 'git', status: 'missing', detail: described.error }
      : described.description.toolVersion === null
        ? {
            id: 'git',
            status: 'missing',
            detail: described.description.problem ?? `${plugin.displayName} could not be run.`,
          }
        : { id: 'git', status: 'ok', detail: described.description.toolVersion };
    return [tool, await this.probeIdentity(tool.status === 'ok')];
  }

  /**
   * Reads the committer identity.
   * @returns Returns the identity, or null when no plugin can answer.
   */
  public async getIdentity(): Promise<GitIdentity | null> {
    const plugin: VersionControlDescriptor | null = this.host.preferredPlugin();
    if (plugin === null) {
      return null;
    }
    const response: VersionControlResponse<'getIdentity'> = await this.host.requestGlobal(
      plugin.id,
      'getIdentity',
      {},
    );
    return response.ok ? response.result : null;
  }

  /**
   * Writes the committer identity, leaving either field the caller left empty as it was.
   * @param identity The identity to write, trimmed.
   * @returns Returns the identity held afterwards, or null when no plugin could write it.
   */
  public async setIdentity(identity: GitIdentity): Promise<GitIdentity | null> {
    const plugin: VersionControlDescriptor | null = this.host.preferredPlugin();
    if (plugin === null) {
      return null;
    }
    const current: GitIdentity | null = await this.getIdentity();
    const wanted: VcsIdentity = {
      name: identity.name.length > 0 ? identity.name : (current?.name ?? ''),
      email: identity.email.length > 0 ? identity.email : (current?.email ?? ''),
    };
    const response: VersionControlResponse<'setIdentity'> = await this.host.requestGlobal(
      plugin.id,
      'setIdentity',
      wanted,
    );
    return response.ok ? this.getIdentity() : null;
  }

  /**
   * Reports whether commits will be attributed to anybody. A missing identity is invisible until the
   * first commit is refused, hours into a session, with an error naming a config key rather than a
   * thing to do — which is why the wizard checks it.
   * @param toolAvailable Whether the tool answered at all.
   * @returns Returns the result.
   */
  private async probeIdentity(toolAvailable: boolean): Promise<SetupProbeResult> {
    const identity: GitIdentity | null = toolAvailable ? await this.getIdentity() : null;
    if (identity === null) {
      return {
        id: 'git-identity',
        status: 'unknown',
        detail: 'Could not be read, because git is not available.',
      };
    }
    const missing: readonly string[] = [
      ...(identity.name.length === 0 ? ['name'] : []),
      ...(identity.email.length === 0 ? ['email'] : []),
    ];
    const status: SetupProbeStatus = missing.length === 0 ? 'ok' : 'warn';
    return {
      id: 'git-identity',
      status,
      detail:
        status === 'ok'
          ? `${identity.name} <${identity.email}>`
          : `No ${missing.join(' or ')} configured, so commits will be refused. Set it on the Source Control step.`,
    };
  }
}
