import { describe, expect, it, vi } from 'vitest';
import type { HostedRepositoryRef } from '@shared/api/hosting-protocol';
import type { VcsRemote } from '@shared/api/version-control-protocol';
import type { VersionControlHost } from '../version-control/version-control-host';
import { HostingAgentAccess, orderRemotes, RunHosting } from './hosting-agent-access';
import type { HostingDescriptor } from './hosting-descriptor';
import type { HostingHost } from './hosting-host';
import type { HostingCaller } from './hosting-write-gate';

/**
 * Builds a remote.
 * @param name Its name.
 * @param url Its URL.
 * @returns Returns the remote.
 */
function remote(name: string, url: string): VcsRemote {
  return { name, url, branches: [] };
}

/**
 * Builds the access over fakes: a repository at `/work/repo` with the given remotes, and a GitHub
 * plugin serving github.com.
 * @param remotes The repository's remotes.
 * @param options What the fakes do differently.
 * @returns Returns the access and the fakes' spies.
 */
function build(
  remotes: readonly VcsRemote[],
  options: { installed?: boolean; inRepository?: boolean; describeFails?: boolean } = {},
): {
  access: HostingAgentAccess;
  closed: string[];
  requestFor: ReturnType<typeof vi.fn>;
} {
  const closed: string[] = [];
  const versionControl: Partial<VersionControlHost> = {
    openRepository: (): Promise<{ root: string; name: string; pluginId: string } | null> =>
      Promise.resolve(
        options.inRepository === false
          ? null
          : { root: '/work/repo', name: 'repo', pluginId: 'onixlabs.git' },
      ),
    request: (() =>
      Promise.resolve({
        id: 1,
        ok: true,
        result: { branches: [], remotes, tags: [] },
      })) as unknown as VersionControlHost['request'],
    closeRepository: (root: unknown): void => {
      closed.push(String(root));
    },
  };
  const plugin: Partial<HostingDescriptor> = {
    id: 'onixlabs.github',
    resolve: () =>
      options.installed === false
        ? { available: false, reason: 'not installed' }
        : { available: true, spec: { command: 'github', args: [] } },
  };
  const requestFor: ReturnType<typeof vi.fn> = vi.fn(() =>
    Promise.resolve({ id: 1, ok: true, result: [] }),
  );
  const hosting: Partial<HostingHost> = {
    detect: (url: unknown) => {
      const match: RegExpMatchArray | null = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(String(url));
      return match === null
        ? null
        : {
            repository: { host: 'github.com', owner: match[1], name: match[2] },
            plugin: plugin as HostingDescriptor,
          };
    },
    describeRepository: () =>
      Promise.resolve(
        options.describeFails === true
          ? { ok: false as const, error: 'Not signed in.' }
          : {
              ok: true as const,
              pluginId: 'onixlabs.github',
              displayName: 'GitHub',
              capabilities: ['issues', 'createIssue'] as const,
            },
      ),
    requestFor: requestFor as unknown as HostingHost['requestFor'],
  };
  return {
    access: new HostingAgentAccess(hosting as HostingHost, versionControl as VersionControlHost),
    closed,
    requestFor,
  };
}

describe('orderRemotes', () => {
  it('triesOriginThenUpstream_thenTheRestAsListed', () => {
    const ordered: readonly VcsRemote[] = orderRemotes([
      remote('fork', 'a'),
      remote('upstream', 'b'),
      remote('mirror', 'c'),
      remote('origin', 'd'),
    ]);

    expect(ordered.map((entry: VcsRemote): string => entry.name)).toEqual([
      'origin',
      'upstream',
      'fork',
      'mirror',
    ]);
  });
});

describe('HostingAgentAccess', () => {
  it('resolve_findsTheRepositoryTheWorkspacesRemoteNames_withWhatItAllows', async () => {
    const { access, closed } = build([
      remote('upstream', 'https://github.com/onix-labs/studio.git'),
      remote('origin', 'git@github.com:matthew/studio.git'),
    ]);

    const run: RunHosting | null = await access.resolve('/work/repo/src');

    // origin is preferred over upstream, as the source-control panels prefer it.
    expect(run).toEqual({
      pluginId: 'onixlabs.github',
      provider: 'GitHub',
      repository: { host: 'github.com', owner: 'matthew', name: 'studio' },
      capabilities: ['issues', 'createIssue'],
    });
    // The repository is opened only for the read, so a run does not hold it open.
    expect(closed).toEqual(['/work/repo']);
  });

  it('resolve_skipsARemoteNoInstalledPluginServes_forTheNextOne', async () => {
    const { access } = build([
      remote('origin', 'https://gitlab.com/onix-labs/studio.git'),
      remote('upstream', 'https://github.com/onix-labs/studio.git'),
    ]);

    const run: RunHosting | null = await access.resolve('/work/repo');

    expect(run?.repository).toEqual({ host: 'github.com', owner: 'onix-labs', name: 'studio' });
  });

  it('resolve_findsNothing_withoutAWorkspaceARepositoryOrAnInstalledPlugin', async () => {
    const remotes: readonly VcsRemote[] = [remote('origin', 'https://github.com/a/b.git')];

    expect(await build(remotes).access.resolve(null)).toBeNull();
    expect(await build(remotes, { inRepository: false }).access.resolve('/work')).toBeNull();
    expect(await build(remotes, { installed: false }).access.resolve('/work/repo')).toBeNull();
    // A host that will not describe the repository (signed out) offers nothing either.
    expect(await build(remotes, { describeFails: true }).access.resolve('/work/repo')).toBeNull();
  });

  it('request_goesThroughTheHostingHostAsTheCaller_toThePluginServingTheRepository', async () => {
    const { access, requestFor } = build([]);
    const repository: HostedRepositoryRef = { host: 'github.com', owner: 'a', name: 'b' };
    const caller: HostingCaller = { kind: 'user' };

    await access.request(
      { pluginId: 'onixlabs.github', provider: 'GitHub', repository, capabilities: [] },
      'listIssues',
      { repository },
      caller,
    );

    expect(requestFor).toHaveBeenCalledWith(
      'onixlabs.github',
      'listIssues',
      { repository },
      caller,
    );
  });
});
