import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForgeHostAccount, ForgeRepositoryCapabilities } from '@shared/api/forge-types';
import {
  HostedRepository,
  HostingDescription,
  HostingOp,
  HostingParams,
  HostingResponse,
} from '@shared/api/hosting-protocol';
import { HostingCredentialStore } from './hosting-credential-store';
import { HostingDescriptor, HostingResolution } from './hosting-descriptor';
import { HostingEndpoint } from './hosting-endpoint';
import { HostingHost } from './hosting-host';
import { asIssueNumber, asRepository, HostingManager } from './hosting-manager';
import { HostingSettings } from './hosting-settings';

/**
 * A plugin answering from a table, recording what it was asked.
 */
class FakeEndpoint implements HostingEndpoint {
  public running: boolean = false;
  public starts: number = 0;
  public readonly sent: { op: HostingOp; params: unknown }[] = [];

  /**
   * Initializes the fake.
   * @param answers How each operation is answered.
   */
  public constructor(private readonly answers: Partial<Record<HostingOp, HostingResponse>>) {}

  /**
   * Starts the fake, whatever sign-in choices it is given.
   * @returns Returns the description.
   */
  public start(): Promise<HostingDescription> {
    this.running = true;
    this.starts++;
    return Promise.resolve({
      protocol: '1.0',
      capabilities: [
        'pullRequests',
        'issues',
        'ciRuns',
        'ciRerun',
        'ciCancel',
        'accounts',
        'listRepositories',
        'createRepository',
      ],
    });
  }

  /**
   * Answers a request.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the answer.
   */
  public request<Op extends HostingOp>(
    op: Op,
    params: HostingParams<Op>,
  ): Promise<HostingResponse<Op>> {
    this.sent.push({ op, params });
    return Promise.resolve(
      (this.answers[op] ?? { id: 1, ok: true, result: [] }) as unknown as HostingResponse<Op>,
    );
  }

  /**
   * Stops the fake.
   */
  public dispose(): void {
    this.running = false;
  }
}

describe('HostingManager', () => {
  let installed: boolean;
  let endpoint: FakeEndpoint;
  let blob: string | null;
  let directory: string;
  let settings: HostingSettings;
  let manager: HostingManager;

  /**
   * Builds the manager over one GitHub-like plugin.
   * @param answers How the plugin answers.
   */
  function build(answers: Partial<Record<HostingOp, HostingResponse>> = {}): void {
    const descriptor: HostingDescriptor = {
      id: 'onixlabs.github',
      displayName: 'GitHub',
      priority: 100,
      hosts: ['github.com', 'www.github.com'],
      capabilities: [
        'pullRequests',
        'issues',
        'ciRuns',
        'ciRerun',
        'ciCancel',
        'accounts',
        'listRepositories',
        'createRepository',
      ],
      authModes: ['cli', 'studio'],
      commandLineTools: ['gh'],
      resolve: (): HostingResolution =>
        installed
          ? { available: true, spec: { command: 'github', args: [] } }
          : { available: false, reason: 'GitHub is not installed.' },
    };
    endpoint = new FakeEndpoint({
      describeRepository: {
        id: 1,
        ok: true,
        result: { capabilities: ['pullRequests', 'ciRuns'] },
      },
      ...answers,
    });
    const store: HostingCredentialStore = new HostingCredentialStore({
      load: (): string | null => blob,
      save: (plaintext: string | null): void => {
        blob = plaintext;
      },
    });
    settings = new HostingSettings(path.join(directory, 'hosting.json'));
    const host: HostingHost = new HostingHost({
      descriptors: () => [descriptor],
      authFor: (pluginId: string) => settings.authFor(pluginId),
      credential: (name: string) => Promise.resolve(store.token(name)),
      createClient: () => endpoint,
    });
    manager = new HostingManager(host, store, settings);
  }

  beforeEach(() => {
    installed = true;
    blob = null;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hosting-manager-'));
    build();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('detect', () => {
    it('namesTheRepositoryAndThePluginServingIt', () => {
      expect(manager.detect('git@github.com:onix-labs/studio.git')).toEqual({
        provider: 'GitHub',
        host: 'github.com',
        owner: 'onix-labs',
        name: 'studio',
      });
    });

    it('findsNothing_whenThePluginIsNotInstalled', () => {
      // #820: with GitHub uninstalled there is no forge, so the sections are absent, not broken.
      installed = false;

      expect(manager.detect('https://github.com/onix-labs/studio.git')).toBeNull();
    });

    it('findsNothing_forAHostNoPluginServes', () => {
      expect(manager.detect('https://gitlab.com/a/b.git')).toBeNull();
    });
  });

  describe('describe', () => {
    it('saysWhatTheRepositoryAllows', async () => {
      const described: ForgeRepositoryCapabilities | null = await manager.describe({
        provider: 'GitHub',
        host: 'github.com',
        owner: 'onix-labs',
        name: 'studio',
      });

      expect(described).toEqual({ provider: 'GitHub', capabilities: ['pullRequests', 'ciRuns'] });
    });

    it('refusesAReferenceThatCouldRedirectThePath', async () => {
      expect(await manager.describe({ host: 'github.com', owner: 'a/../b', name: 'c' })).toBeNull();
    });
  });

  describe('hosts', () => {
    it('listsEachHostThePluginServes_withHowItIsSignedIn', async () => {
      build({
        authStatus: {
          id: 1,
          ok: true,
          result: {
            authenticated: true,
            mode: 'cli',
            identity: { login: 'matthew', name: null },
            detail: "Signed in as matthew using the GitHub CLI's login.",
          },
        },
      });

      const hosts: readonly ForgeHostAccount[] = await manager.hosts();

      // www.github.com is an alias of github.com, so it is not a row of its own.
      expect(hosts).toEqual([
        {
          pluginId: 'onixlabs.github',
          provider: 'GitHub',
          host: 'github.com',
          authModes: ['cli', 'studio'],
          authMode: null,
          status: {
            mode: 'cli',
            authenticated: true,
            hasStoredToken: false,
            identity: { login: 'matthew', name: null },
            detail: "Signed in as matthew using the GitHub CLI's login.",
          },
        },
      ]);
      expect(endpoint.sent[0]).toEqual({ op: 'authStatus', params: { host: 'github.com' } });
    });

    it('listsNothing_whenNoHostingPluginIsInstalled', async () => {
      // Core names no host: with GitHub uninstalled there is nothing to sign in to.
      installed = false;

      expect(await manager.hosts()).toEqual([]);
    });
  });

  describe('setAuthMode', () => {
    it('recordsTheChoiceForTheHostAndItsAlias_andRestartsThePlugin', async () => {
      await manager.hosts();
      const before: number = endpoint.starts;

      const account: ForgeHostAccount | null = await manager.setAuthMode(
        'onixlabs.github',
        'GitHub.com',
        'studio',
      );

      expect(account?.authMode).toBe('studio');
      expect(settings.authFor('onixlabs.github')).toEqual({
        'github.com': 'studio',
        'www.github.com': 'studio',
      });
      // The choice travels in the handshake, so the plugin is started afresh to receive it.
      expect(endpoint.starts).toBe(before + 1);
    });

    it('returnsToThePluginsDefault_givenNull', async () => {
      await manager.setAuthMode('onixlabs.github', 'github.com', 'cli');

      const account: ForgeHostAccount | null = await manager.setAuthMode(
        'onixlabs.github',
        'github.com',
        null,
      );

      expect(account?.authMode).toBeNull();
      expect(settings.authFor('onixlabs.github')).toEqual({});
    });

    it('refusesAModeThePluginDoesNotOffer_aHostItDoesNotServe_orAPluginNotInstalled', async () => {
      expect(await manager.setAuthMode('onixlabs.github', 'github.com', 'oauth')).toBeNull();
      expect(await manager.setAuthMode('onixlabs.github', 'gitlab.com', 'cli')).toBeNull();
      expect(await manager.setAuthMode('someone.else', 'github.com', 'cli')).toBeNull();
      installed = false;
      expect(await manager.setAuthMode('onixlabs.github', 'github.com', 'cli')).toBeNull();
      expect(settings.authFor('onixlabs.github')).toEqual({});
    });
  });

  describe('accounts and repositories', () => {
    it('askThePluginServingTheHost', async () => {
      build({
        listAccounts: { id: 1, ok: true, result: [{ login: 'matthew', name: null, kind: 'user' }] },
      });

      const accounts: Awaited<ReturnType<HostingManager['accounts']>> =
        await manager.accounts('GitHub.com');
      await manager.repositories('github.com', 'onix-labs');

      expect(accounts).toEqual({
        ok: true,
        value: [{ login: 'matthew', name: null, kind: 'user' }],
      });
      expect(endpoint.sent.map((entry: { op: string; params: unknown }) => entry.params)).toEqual(
        expect.arrayContaining([
          { host: 'github.com' },
          { host: 'github.com', account: 'onix-labs' },
        ]),
      );
    });

    it('refuseAHostNoInstalledPluginServes_andAnAccountThatCouldRedirectThePath', async () => {
      build();

      expect((await manager.accounts('gitlab.com')).ok).toBe(false);
      for (const account of ['', 'a/b', 'a?b', 'a b', 42]) {
        expect((await manager.repositories('github.com', account)).ok).toBe(false);
      }
      expect(endpoint.sent.some((entry: { op: string }) => entry.op === 'listRepositories')).toBe(
        false,
      );
    });

    it('createRepository_asksThePluginServingTheHost_asTheUser', async () => {
      build({
        createRepository: {
          id: 1,
          ok: true,
          result: { name: 'todo' } as unknown as HostedRepository,
        },
      });

      const made: Awaited<ReturnType<HostingManager['createRepository']>> =
        await manager.createRepository('GitHub.com', 'matthew', 'todo', true);

      expect(made).toEqual({ ok: true, value: { name: 'todo' } });
      expect(
        endpoint.sent.find((entry: { op: string }) => entry.op === 'createRepository')?.params,
      ).toEqual({ host: 'github.com', account: 'matthew', name: 'todo', private: true });
    });

    it('createRepository_refusesAHostNoPluginServes_andAnAccountThatCouldRedirectThePath', async () => {
      build();

      expect((await manager.createRepository('gitlab.com', 'matthew', 'todo', false)).ok).toBe(
        false,
      );
      expect((await manager.createRepository('github.com', 'a/b', 'todo', false)).ok).toBe(false);
      expect(endpoint.sent.some((entry: { op: string }) => entry.op === 'createRepository')).toBe(
        false,
      );
    });
  });

  describe('setToken', () => {
    it('storesTheTokenForTheHostAndItsAlias_andABlankOneClearsIt', async () => {
      const stored: ForgeHostAccount | null = await manager.setToken(
        'onixlabs.github',
        'github.com',
        'ghp_pasted',
      );
      expect(stored?.status.hasStoredToken).toBe(true);
      expect(blob).toBe(
        JSON.stringify({ 'github.com': 'ghp_pasted', 'www.github.com': 'ghp_pasted' }),
      );

      await manager.setToken('onixlabs.github', 'github.com', '   ');
      expect(blob).toBeNull();
    });

    it('storesNothing_forAHostThePluginDoesNotServe', async () => {
      expect(await manager.setToken('onixlabs.github', 'evil.example', 'ghp_pasted')).toBeNull();
      expect(blob).toBeNull();
    });
  });
});

describe('the renderer-input checks', () => {
  it('asRepository_acceptsAReference_andRefusesOneThatCouldRedirectThePath', () => {
    expect(asRepository({ host: 'GitHub.com', owner: 'a', name: 'b' })).toEqual({
      host: 'github.com',
      owner: 'a',
      name: 'b',
    });
    for (const owner of ['a/b', 'a\\b', 'a?b', 'a#b', '']) {
      expect(asRepository({ host: 'github.com', owner, name: 'b' })).toBeNull();
    }
    expect(asRepository(null)).toBeNull();
  });

  it('asIssueNumber_turnsAnythingButAPositiveWholeNumberIntoZero', () => {
    expect(asIssueNumber(12)).toBe(12);
    for (const value of [0, -1, 1.5, '12', Number.NaN, null]) {
      expect(asIssueNumber(value)).toBe(0);
    }
  });
});
