import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';
import {
  HostedRepositoryRef,
  HostingAuthMode,
  HostingCapability,
  HostingDescription,
  HostingOp,
  HostingParams,
  HostingResponse,
} from '@shared/api/hosting-protocol';
import { HostingDescriptor, HostingResolution, HostingSpec } from './hosting-descriptor';
import { HostingCredentialSource, HostingEndpoint } from './hosting-endpoint';
import { HostedRepositoryDescription, HostingHost, HostingPluginDescription } from './hosting-host';
import { HostingCaller } from './hosting-write-gate';

/**
 * A repository on github.com.
 */
const REPO: HostedRepositoryRef = { host: 'github.com', owner: 'onix-labs', name: 'studio' };

/**
 * The caller every user-initiated request is made as.
 */
const USER: HostingCaller = { kind: 'user' };

/**
 * Answers one request a fake plugin is sent.
 */
type Answer = (params: unknown) => HostingResponse | Promise<HostingResponse>;

/**
 * An in-memory plugin: confirms the capabilities it is given and answers requests from a table.
 */
class FakeEndpoint implements HostingEndpoint {
  /**
   * Gets every request sent, in order.
   */
  public readonly sent: { op: HostingOp; params: unknown }[] = [];

  /**
   * Gets the auth choices the handshake carried.
   */
  public startedWith: Readonly<Record<string, HostingAuthMode>> | null = null;

  /**
   * Gets whether the endpoint is running.
   */
  public running: boolean = false;

  /**
   * Initializes the fake.
   * @param capabilities What the handshake confirms.
   * @param answers How each operation is answered.
   * @param credentials Where its credential requests go.
   */
  public constructor(
    private readonly capabilities: readonly HostingCapability[],
    private readonly answers: Partial<Record<HostingOp, Answer>>,
    public readonly credentials: HostingCredentialSource,
  ) {}

  /**
   * Starts the fake.
   * @param auth The auth choices.
   * @returns Returns the description.
   */
  public start(auth: Readonly<Record<string, HostingAuthMode>>): Promise<HostingDescription> {
    this.startedWith = auth;
    this.running = true;
    return Promise.resolve({ protocol: '1.0', capabilities: this.capabilities });
  }

  /**
   * Answers a request from the table, or with an empty success.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the answer.
   */
  public async request<Op extends HostingOp>(
    op: Op,
    params: HostingParams<Op>,
  ): Promise<HostingResponse<Op>> {
    this.sent.push({ op, params });
    const answer: Answer | undefined = this.answers[op];
    return (answer === undefined
      ? { id: 1, ok: true, result: [] }
      : await answer(params)) as unknown as HostingResponse<Op>;
  }

  /**
   * Stops the fake.
   */
  public dispose(): void {
    this.running = false;
  }
}

/**
 * Builds a descriptor for a contributed hosting plugin.
 * @param id The plugin id.
 * @param hosts The hosts it serves.
 * @param priority Its priority.
 * @param capabilities What its manifest declares.
 * @returns Returns the descriptor.
 */
function descriptor(
  id: string,
  hosts: readonly string[],
  priority: number = 100,
  capabilities: readonly HostingCapability[] = [
    'issues',
    'pullRequests',
    'ciRuns',
    'ciRerun',
    'ciCancel',
    'createRepository',
    'createIssue',
    'agentTools',
  ],
): HostingDescriptor {
  return {
    id,
    displayName: id,
    priority,
    hosts,
    capabilities,
    authModes: ['cli', 'studio'],
    resolve: () => ({ available: true, spec: { command: id, args: [] } }),
  };
}

/**
 * Builds an agent caller.
 * @param posture The run's posture.
 * @param policies The run's per-tool policies.
 * @param confirmation What the user answers when asked.
 * @returns Returns the caller and the spy on its confirm.
 */
function agent(
  posture: AiPermissionPosture,
  policies: Readonly<Record<string, AiToolPolicy>> = {},
  confirmation: boolean = true,
): { caller: HostingCaller; confirm: Mock<(summary: string) => Promise<boolean>> } {
  const confirm: Mock<(summary: string) => Promise<boolean>> = vi
    .fn<(summary: string) => Promise<boolean>>()
    .mockResolvedValue(confirmation);
  return { caller: { kind: 'agent', posture, policies, confirm }, confirm };
}

describe('HostingHost', () => {
  let descriptors: HostingDescriptor[];
  let endpoints: Map<string, FakeEndpoint>;
  let confirmed: readonly HostingCapability[];
  let repositoryAllows: readonly HostingCapability[];
  let auth: Record<string, Record<string, HostingAuthMode>>;
  let stored: Record<string, string>;
  let now: number;
  let tools: readonly { name: string; writes: boolean }[];
  let created: number;

  /**
   * Builds the host over fake plugins.
   * @returns Returns the host.
   */
  function build(): HostingHost {
    return new HostingHost({
      descriptors: () => descriptors,
      authFor: (pluginId: string) => auth[pluginId] ?? {},
      credential: (host: string) => Promise.resolve(stored[host] ?? null),
      now: () => now,
      createClient: (
        id: string,
        _spec: HostingSpec,
        credentials: HostingCredentialSource,
      ): HostingEndpoint => {
        const endpoint: FakeEndpoint = new FakeEndpoint(
          confirmed,
          {
            describeRepository: () => ({
              id: 1,
              ok: true,
              result: { capabilities: repositoryAllows },
            }),
            listAgentTools: () => ({
              id: 1,
              ok: true,
              result: tools.map((tool) => ({
                ...tool,
                description: '',
                inputSchema: {},
              })),
            }),
            invokeAgentTool: () => ({ id: 1, ok: true, result: { output: 'done' } }),
            rerunCiRun: () => ({ id: 1, ok: true, result: {} }),
            createIssue: () => ({ id: 1, ok: true, result: {} }),
          },
          credentials,
        );
        endpoints.set(id, endpoint);
        created += 1;
        return endpoint;
      },
    });
  }

  /**
   * Gets the operations a plugin was sent, without the describe calls the host makes for itself.
   * @param id The plugin.
   * @returns Returns the operations.
   */
  function sent(id: string): readonly HostingOp[] {
    return (endpoints.get(id)?.sent ?? [])
      .map((entry) => entry.op)
      .filter((op) => op !== 'describeRepository' && op !== 'listAgentTools');
  }

  beforeEach(() => {
    descriptors = [descriptor('onixlabs.github', ['github.com', 'ghe.example.com'])];
    endpoints = new Map<string, FakeEndpoint>();
    confirmed = [
      'issues',
      'pullRequests',
      'ciRuns',
      'ciRerun',
      'ciCancel',
      'createRepository',
      'agentTools',
    ];
    repositoryAllows = ['issues', 'pullRequests', 'ciRuns', 'ciRerun', 'ciCancel'];
    auth = {};
    stored = { 'github.com': 'studio-token', 'gitlab.com': 'other-token' };
    now = 1_000;
    created = 0;
    tools = [
      { name: 'list_releases', writes: false },
      { name: 'create_release', writes: true },
    ];
  });

  describe('routing', () => {
    it('pluginForHost_picksTheHighestPriorityPluginServingTheHost_caseInsensitively', () => {
      descriptors = [
        descriptor('low', ['github.com'], 1),
        descriptor('high', ['github.com'], 200),
        descriptor('gitlab', ['gitlab.com'], 500),
      ];

      expect(build().pluginForHost('GitHub.com')?.id).toBe('high');
      expect(build().pluginForHost('bitbucket.org')).toBeNull();
    });

    it('detect_readsTheRemote_andFindsThePluginServingItsHost', () => {
      const detected: ReturnType<HostingHost['detect']> = build().detect(
        'git@github.com:onix-labs/studio.git',
      );

      expect(detected?.repository).toEqual(REPO);
      expect(detected?.plugin.id).toBe('onixlabs.github');
      expect(build().detect('https://gitlab.com/a/b.git')).toBeNull();
      expect(build().detect(42)).toBeNull();
    });

    it('request_routesByTheRepositorysHost_andRefusesAHostNoPluginServes', async () => {
      const host: HostingHost = build();

      const served: HostingResponse = await host.request('listIssues', { repository: REPO }, USER);
      const unserved: HostingResponse = await host.request(
        'listIssues',
        { repository: { ...REPO, host: 'gitlab.com' } },
        USER,
      );

      expect(served.ok).toBe(true);
      expect(unserved).toMatchObject({ ok: false, code: 'refused' });
    });

    it('requestFor_refusesAHostThePluginDoesNotDeclare', async () => {
      const response: HostingResponse = await build().requestFor(
        'onixlabs.github',
        'listAccounts',
        { host: 'gitlab.com' },
        USER,
      );

      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(endpoints.size).toBe(0);
    });

    it('request_refusesInitialize_andARepositoryRequestWithoutARepository', async () => {
      const host: HostingHost = build();

      expect(
        await host.requestFor('onixlabs.github', 'initialize', { protocol: '1.0', auth: {} }, USER),
      ).toMatchObject({ ok: false, code: 'refused' });
      expect(
        await host.requestFor(
          'onixlabs.github',
          'listIssues',
          {} as HostingParams<'listIssues'>,
          USER,
        ),
      ).toMatchObject({ ok: false, code: 'refused' });
    });
  });

  describe('capabilities', () => {
    it('describePlugin_keepsOnlyWhatTheManifestDeclaredAndTheHandshakeConfirmed', async () => {
      descriptors = [descriptor('onixlabs.github', ['github.com'], 100, ['issues', 'ciRuns'])];
      confirmed = ['issues', 'pullRequests'];

      const described: HostingPluginDescription = await build().describePlugin('onixlabs.github');

      expect(described.ok && described.capabilities).toEqual(['issues']);
    });

    it('describeRepository_narrowsThePluginsCapabilitiesToWhatTheRepositoryAllows', async () => {
      // #819's acceptance: Issues switched off on the repository hides Issues, though the plugin has it.
      repositoryAllows = ['pullRequests', 'ciRuns'];

      const described: HostedRepositoryDescription = await build().describeRepository(REPO);

      expect(described.ok && described.capabilities).toEqual(['pullRequests', 'ciRuns']);
    });

    it('request_whenTheRepositoryDoesNotAllowIt_isRefusedWithoutThePluginSeeingIt', async () => {
      repositoryAllows = ['pullRequests'];
      const host: HostingHost = build();

      const response: HostingResponse = await host.request(
        'listIssues',
        { repository: REPO },
        USER,
      );

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(sent('onixlabs.github')).toEqual([]);
    });

    it('request_whenThePluginLacksTheCapability_isRefusedWithoutAskingTheRepository', async () => {
      confirmed = ['issues'];
      const host: HostingHost = build();

      const response: HostingResponse = await host.request(
        'listCiRuns',
        { repository: REPO },
        USER,
      );

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(endpoints.get('onixlabs.github')?.sent).toEqual([]);
    });

    it('describeRepository_isReusedUntilItGoesStale', async () => {
      const host: HostingHost = build();
      await host.request('listIssues', { repository: REPO }, USER);
      await host.request('listPullRequests', { repository: REPO }, USER);
      const describes: () => number = (): number =>
        endpoints.get('onixlabs.github')?.sent.filter((e) => e.op === 'describeRepository')
          .length ?? 0;
      expect(describes()).toBe(1);

      now += 10 * 60_000;
      await host.request('listIssues', { repository: REPO }, USER);

      expect(describes()).toBe(2);
    });

    it('restartPlugin_forgetsWhatItsRepositoriesAllowed', async () => {
      const host: HostingHost = build();
      await host.describeRepository(REPO);
      repositoryAllows = ['issues'];

      host.restartPlugin('onixlabs.github');
      const described: HostedRepositoryDescription = await host.describeRepository(REPO);

      expect(described.ok && described.capabilities).toEqual(['issues']);
    });
  });

  describe('credentials', () => {
    it('credential_isHandedOverForADeclaredHost', async () => {
      const host: HostingHost = build();
      await host.describePlugin('onixlabs.github');

      const token: string | null = await endpoints
        .get('onixlabs.github')!
        .credentials('GitHub.com');

      expect(token).toBe('studio-token');
    });

    it('credential_isRefusedForAHostThePluginDoesNotDeclare', async () => {
      // A plugin is code Studio did not write; it gets no other host's secret by asking.
      const host: HostingHost = build();
      await host.describePlugin('onixlabs.github');

      expect(await endpoints.get('onixlabs.github')!.credentials('gitlab.com')).toBeNull();
    });

    it('credential_isRefused_whenTheUserChoseTheHostsCliLogin', async () => {
      auth = { 'onixlabs.github': { 'github.com': 'cli' } };
      const host: HostingHost = build();
      await host.describePlugin('onixlabs.github');

      expect(await endpoints.get('onixlabs.github')!.credentials('github.com')).toBeNull();
      expect(endpoints.get('onixlabs.github')?.startedWith).toEqual({ 'github.com': 'cli' });
    });
  });

  describe('writes', () => {
    it('aUsersWrite_isSentAsAsked', async () => {
      const response: HostingResponse = await build().request(
        'rerunCiRun',
        { repository: REPO, runId: '7' },
        USER,
      );

      expect(response.ok).toBe(true);
      expect(sent('onixlabs.github')).toEqual(['rerunCiRun']);
    });

    it('anAgentsWrite_underPrompt_asksFirst_andIsNotSentWhenDeclined', async () => {
      const { caller, confirm } = agent('prompt', {}, false);

      const response: HostingResponse = await build().request(
        'rerunCiRun',
        { repository: REPO, runId: '7' },
        caller,
      );

      // The prompt says what the write does, in the user's terms.
      expect(confirm).toHaveBeenCalledWith('onixlabs.github: re-run CI run 7 in onix-labs/studio');
      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(sent('onixlabs.github')).toEqual([]);
    });

    it('anAgentsWrite_underAutoAll_isSentWithoutAsking', async () => {
      const { caller, confirm } = agent('auto-all');

      const response: HostingResponse = await build().request(
        'cancelCiRun',
        { repository: REPO, runId: '7' },
        caller,
      );

      expect(confirm).not.toHaveBeenCalled();
      expect(response.ok).toBe(true);
    });

    it('anAgentsWrite_deniedByPolicy_isRefusedEvenUnderAutoAll', async () => {
      const { caller, confirm } = agent('auto-all', { hosting_rerun_ci_run: 'deny' });

      const response: HostingResponse = await build().request(
        'rerunCiRun',
        { repository: REPO, runId: '7' },
        caller,
      );

      expect(confirm).not.toHaveBeenCalled();
      expect(response).toMatchObject({ ok: false, code: 'refused' });
    });

    it('anAgentOpeningAnIssue_isAWrite_askedWithItsTitle', async () => {
      // #851: the new writes are gated like CI's, by the same table.
      confirmed = [...confirmed, 'createIssue'];
      repositoryAllows = [...repositoryAllows, 'createIssue'];
      const { caller, confirm } = agent('prompt', {}, true);

      const response: HostingResponse = await build().request(
        'createIssue',
        { repository: REPO, title: 'Fix login' },
        caller,
      );

      expect(confirm).toHaveBeenCalledWith(
        'onixlabs.github: open an issue “Fix login” in onix-labs/studio',
      );
      expect(response.ok).toBe(true);
      expect(sent('onixlabs.github')).toEqual(['createIssue']);
    });

    it('openingAnIssue_whereTheRepositoryDoesNotAllowIt_isRefusedBeforeAnyPrompt', async () => {
      confirmed = [...confirmed, 'createIssue'];
      const { caller, confirm } = agent('prompt', {}, true);

      const response: HostingResponse = await build().request(
        'createIssue',
        { repository: REPO, title: 'Fix login' },
        caller,
      );

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(confirm).not.toHaveBeenCalled();
      expect(sent('onixlabs.github')).toEqual([]);
    });

    it('openingAnIssue_withAPluginThatLacksTheCapability_isRefused_evenForTheUser', async () => {
      const response: HostingResponse = await build().request(
        'createIssue',
        { repository: REPO, title: 'Fix login' },
        USER,
      );

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(sent('onixlabs.github')).toEqual([]);
    });

    it('anAgentsRead_isNeverGated', async () => {
      const { caller, confirm } = agent('prompt');

      await build().request('listIssues', { repository: REPO }, caller);

      expect(confirm).not.toHaveBeenCalled();
    });

    it('anAgentTool_isGatedOnlyWhenItSaysItWrites', async () => {
      const host: HostingHost = build();
      const { caller, confirm } = agent('prompt');

      await host.requestFor(
        'onixlabs.github',
        'invokeAgentTool',
        { name: 'list_releases', input: {}, repository: REPO },
        caller,
      );
      expect(confirm).not.toHaveBeenCalled();

      await host.requestFor(
        'onixlabs.github',
        'invokeAgentTool',
        { name: 'create_release', input: {}, repository: REPO },
        caller,
      );
      expect(confirm).toHaveBeenCalledWith('onixlabs.github: create_release');
    });

    it('anAgentTool_isKnownToPoliciesByPluginAndName', async () => {
      const { caller, confirm } = agent('prompt', {
        'hosting:onixlabs.github/create_release': 'allow',
      });

      const response: HostingResponse = await build().requestFor(
        'onixlabs.github',
        'invokeAgentTool',
        { name: 'create_release', input: {} },
        caller,
      );

      expect(confirm).not.toHaveBeenCalled();
      expect(response.ok).toBe(true);
    });

    it('anAgentTool_thePluginDoesNotOffer_isRefused', async () => {
      const { caller } = agent('auto-all');

      const response: HostingResponse = await build().requestFor(
        'onixlabs.github',
        'invokeAgentTool',
        { name: 'delete_everything', input: {} },
        caller,
      );

      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(sent('onixlabs.github')).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    it('identicalConcurrentReads_areAnsweredByOneRequest', async () => {
      const host: HostingHost = build();
      await host.describeRepository(REPO);

      await Promise.all([
        host.request('listIssues', { repository: REPO }, USER),
        host.request('listIssues', { repository: REPO }, USER),
      ]);

      expect(sent('onixlabs.github')).toEqual(['listIssues']);
    });

    it('anUninstalledPlugin_saysWhy', async () => {
      descriptors = [
        {
          ...descriptor('onixlabs.github', ['github.com']),
          resolve: (): HostingResolution => ({
            available: false,
            reason: 'GitHub is not installed.',
          }),
        },
      ];

      const described: HostingPluginDescription = await build().describePlugin('onixlabs.github');

      expect(described).toEqual({ ok: false, error: 'GitHub is not installed.' });
    });

    it('twoFirstRequests_startOneProcess', async () => {
      const host: HostingHost = build();

      await Promise.all([
        host.describePlugin('onixlabs.github'),
        host.describePlugin('onixlabs.github'),
      ]);

      expect(created).toBe(1);
    });
  });
});
