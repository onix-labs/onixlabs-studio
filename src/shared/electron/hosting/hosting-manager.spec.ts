import { beforeEach, describe, expect, it } from 'vitest';
import { ForgeAuthStatus, ForgeRepositoryCapabilities } from '@shared/api/forge-types';
import {
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

/**
 * A plugin answering from a table, recording what it was asked.
 */
class FakeEndpoint implements HostingEndpoint {
  public running: boolean = false;
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
    return Promise.resolve({
      protocol: '1.0',
      capabilities: ['pullRequests', 'issues', 'ciRuns', 'ciRerun', 'ciCancel'],
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
      capabilities: ['pullRequests', 'issues', 'ciRuns', 'ciRerun', 'ciCancel'],
      authModes: ['cli', 'studio'],
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
    const host: HostingHost = new HostingHost({
      descriptors: () => [descriptor],
      authFor: () => ({}),
      credential: (name: string) => Promise.resolve(store.token(name)),
      createClient: () => endpoint,
    });
    manager = new HostingManager(host, store);
  }

  beforeEach(() => {
    installed = true;
    blob = null;
    build();
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

  describe('authStatus', () => {
    it('reportsHowThePluginSignedIn_andWhetherStudioHoldsAToken', async () => {
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

      const status: ForgeAuthStatus = await manager.authStatus();

      expect(status).toEqual({
        source: 'gh-cli',
        authenticated: true,
        hasStoredToken: false,
        identity: { login: 'matthew', name: null },
        detail: "Signed in as matthew using the GitHub CLI's login.",
      });
      // The default host is the installed plugin's first, not one core names itself.
      expect(endpoint.sent[0]).toEqual({ op: 'authStatus', params: { host: 'github.com' } });
    });

    it('saysToInstallAPlugin_whenNoneIsInstalled', async () => {
      installed = false;

      const status: ForgeAuthStatus = await manager.authStatus();

      expect(status.authenticated).toBe(false);
      expect(status.detail).toContain('No hosting plugin is installed');
    });
  });

  describe('setToken', () => {
    it('storesTheTokenForTheDefaultHost_andAblankOneClearsIt', async () => {
      await manager.setToken('ghp_pasted');
      expect(blob).toContain('github.com');

      await manager.setToken('   ');
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
