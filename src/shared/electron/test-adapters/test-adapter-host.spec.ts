import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TestAdapterCapability,
  TestAdapterDescription,
  TestAdapterOp,
  TestAdapterResponse,
} from '@shared/api/test-adapter-protocol';
import type {
  TestAdapterInfo,
  TestDebugPlanAnswer,
  TestDiscoverAnswer,
  TestResultsAnswer,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { TestAdapterDescriptor } from './test-adapter-descriptor';
import { TestAdapterEndpoint } from './test-adapter-endpoint';
import { TestAdapterHost, TestAdapterHostOptions } from './test-adapter-host';
import { DirectoryEntry } from './marker-scan';

/**
 * The open workspace root every test works inside.
 */
const ROOT: string = path.resolve('/studio-tests-host/repo');

/**
 * The output folder the fake makes for each run, outside {@link ROOT}.
 */
const OUTPUT: string = path.resolve('/studio-tests-host/scratch/run-1');

/**
 * Records what a fake client was asked.
 */
interface FakeClient {
  readonly client: TestAdapterEndpoint;
  readonly requests: { op: TestAdapterOp; root: string; params: unknown }[];
  readonly starts: { count: number };
  disposed: boolean;
  answer: (op: TestAdapterOp, params: unknown) => TestAdapterResponse;
}

/**
 * Builds a fake client confirming the given capabilities.
 * @param confirmed The capabilities the handshake confirms.
 * @returns Returns the fake and its records.
 */
function fakeClient(confirmed: readonly TestAdapterCapability[]): FakeClient {
  const fake: FakeClient = {
    requests: [],
    starts: { count: 0 },
    disposed: false,
    answer: (op: TestAdapterOp): TestAdapterResponse => ({ id: 1, ok: false, error: op }),
    client: {
      get running(): boolean {
        return fake.starts.count > 0 && !fake.disposed;
      },
      start: (): Promise<TestAdapterDescription> => {
        fake.starts.count += 1;
        fake.disposed = false;
        return Promise.resolve({ protocol: '1.0', capabilities: confirmed, toolVersion: null });
      },
      request: <Op extends TestAdapterOp>(
        op: Op,
        root: string,
        params: unknown,
      ): Promise<TestAdapterResponse<Op>> => {
        fake.requests.push({ op, root, params });
        return Promise.resolve(fake.answer(op, params) as TestAdapterResponse<Op>);
      },
      dispose: (): void => {
        fake.disposed = true;
      },
    },
  };
  return fake;
}

/**
 * Builds a descriptor for an installed adapter.
 * @param overrides Fields to replace.
 * @returns Returns the descriptor.
 */
function descriptor(overrides: Partial<TestAdapterDescriptor> = {}): TestAdapterDescriptor {
  return {
    id: 'dotnet-tests',
    displayName: '.NET Tests',
    frameworks: ['xUnit'],
    priority: 100,
    markers: ['*.csproj'],
    capabilities: ['run', 'runSelected', 'debug'],
    resolve: () => ({ available: true, spec: { command: 'node', args: [] } }),
    ...overrides,
  };
}

/**
 * Records what the host did with output folders.
 */
interface Folders {
  readonly made: string[];
  readonly removed: string[];
}

/**
 * Builds a host over a fake client, with {@link ROOT} open and trusted.
 * @param fake The client.
 * @param overrides Options to replace.
 * @param adapters The contributed adapters.
 * @returns Returns the host and its folder records.
 */
function host(
  fake: FakeClient,
  overrides: Partial<TestAdapterHostOptions> = {},
  adapters: readonly TestAdapterDescriptor[] = [descriptor()],
): { readonly host: TestAdapterHost; readonly folders: Folders } {
  const folders: Folders = { made: [], removed: [] };
  let next: number = 0;
  return {
    folders,
    host: new TestAdapterHost({
      descriptors: () => adapters,
      roots: {
        isWithin: (target: unknown): boolean =>
          target === ROOT || String(target).startsWith(ROOT + path.sep),
      },
      trust: { decisionFor: (): RepositoryTrustDecision => 'trusted' },
      createClient: () => fake.client,
      makeRunDirectory: (): Promise<string> => {
        next += 1;
        const made: string = next === 1 ? OUTPUT : `${OUTPUT}-${next}`;
        folders.made.push(made);
        return Promise.resolve(made);
      },
      removeDirectory: (directory: string): Promise<void> => {
        folders.removed.push(directory);
        return Promise.resolve();
      },
      ...overrides,
    }),
  };
}

/**
 * A command inside {@link ROOT}.
 */
const COMMAND: Record<string, unknown> = {
  executable: 'dotnet',
  args: ['test'],
  cwd: ROOT,
  title: 'Test Shop.Tests',
};

describe('TestAdapterHost (#1351)', () => {
  describe('folders', () => {
    it.each<[string, unknown]>([
      ['not a string', 7],
      ['relative', 'repo'],
      ['not open', path.resolve('/elsewhere')],
      ['carrying a NUL', `${ROOT}\0x`],
    ])('discover_refusesAFolderThatIs %s', async (_name: string, root: unknown) => {
      const fake: FakeClient = fakeClient(['run']);
      const answer: TestDiscoverAnswer = await host(fake).host.discover('dotnet-tests', root);

      expect(answer).toMatchObject({ ok: false, code: 'refused' });
      expect(fake.requests).toEqual([]);
    });

    it.each<RepositoryTrustDecision>(['unknown', 'restricted'])(
      'discover_whenTheFolderIs %s_refusesAsUntrustedWithoutStartingThePlugin',
      async (decision: RepositoryTrustDecision) => {
        const fake: FakeClient = fakeClient(['run']);
        const answer: TestDiscoverAnswer = await host(fake, {
          trust: { decisionFor: (): RepositoryTrustDecision => decision },
        }).host.discover('dotnet-tests', ROOT);

        expect(answer).toMatchObject({ ok: false, code: 'untrusted' });
        expect(fake.starts.count).toBe(0);
      },
    );

    it('discover_namingNoInstalledPlugin_refuses', async () => {
      const answer: TestDiscoverAnswer = await host(fakeClient([])).host.discover('nope', ROOT);

      expect(answer).toMatchObject({ ok: false, code: 'refused' });
    });
  });

  describe('adaptersFor', () => {
    /**
     * Lists a fake tree: a solution with a test project one level down.
     * @param directory The directory.
     * @returns Returns its entries.
     */
    function list(directory: string): Promise<readonly DirectoryEntry[]> {
      if (directory === ROOT) {
        return Promise.resolve([
          { name: 'Shop.sln', directory: false },
          { name: 'Shop.Tests', directory: true },
          { name: 'node_modules', directory: true },
        ]);
      }
      if (directory === path.join(ROOT, 'Shop.Tests')) {
        return Promise.resolve([{ name: 'Shop.Tests.csproj', directory: false }]);
      }
      if (directory === path.join(ROOT, 'node_modules')) {
        return Promise.resolve([{ name: 'package.json', directory: false }]);
      }
      return Promise.resolve([]);
    }

    it('adaptersFor_listsEveryAdapterWhoseMarkerTheFolderHolds_installedOrNot', async () => {
      const adapters: readonly TestAdapterDescriptor[] = [
        descriptor({
          id: 'js-tests',
          displayName: 'JavaScript Tests',
          markers: ['package.json'],
          priority: 50,
        }),
        descriptor(),
        descriptor({
          id: 'other-dotnet',
          displayName: 'Other',
          priority: 10,
          resolve: () => ({ available: false, reason: 'not installed' }),
        }),
      ];
      const infos: readonly TestAdapterInfo[] = await host(
        fakeClient([]),
        { listDirectory: list },
        adapters,
      ).host.adaptersFor(ROOT);

      // node_modules is never entered, so its package.json marks nothing.
      expect(infos).toEqual([
        {
          pluginId: 'dotnet-tests',
          displayName: '.NET Tests',
          frameworks: ['xUnit'],
          installed: true,
          capabilities: ['run', 'runSelected', 'debug'],
        },
        {
          pluginId: 'other-dotnet',
          displayName: 'Other',
          frameworks: ['xUnit'],
          installed: false,
          capabilities: ['run', 'runSelected', 'debug'],
        },
      ]);
    });

    it('adaptersFor_aFolderThatIsNotOpen_answersNothingWithoutReadingIt', async () => {
      const read: string[] = [];
      const infos: readonly TestAdapterInfo[] = await host(fakeClient([]), {
        listDirectory: (directory: string): Promise<readonly DirectoryEntry[]> => {
          read.push(directory);
          return Promise.resolve([]);
        },
      }).host.adaptersFor(path.resolve('/elsewhere'));

      expect(infos).toEqual([]);
      expect(read).toEqual([]);
    });
  });

  describe('discover', () => {
    it('discover_passesTheCheckedTreeOn_droppingLinksOutsideTheFolder', async () => {
      const fake: FakeClient = fakeClient([]);
      fake.answer = (): TestAdapterResponse => ({
        id: 1,
        ok: true,
        result: {
          tests: [
            {
              id: 'p',
              label: 'Shop.Tests',
              kind: 'project',
              children: [
                {
                  id: 't1',
                  label: 'Adds',
                  kind: 'test',
                  location: { file: path.join(ROOT, 'A.cs'), line: 4 },
                },
                {
                  id: 't2',
                  label: 'Leaks',
                  kind: 'test',
                  location: { file: '/etc/passwd', line: 1 },
                },
                { id: 't1', label: 'Duplicate', kind: 'test' },
                { id: 't3', label: 'Odd', kind: 'widget' as never },
              ],
            },
          ],
        },
      });

      const answer: TestDiscoverAnswer = await host(fake).host.discover('dotnet-tests', ROOT);

      expect(answer).toEqual({
        ok: true,
        value: {
          tests: [
            {
              id: 'p',
              label: 'Shop.Tests',
              kind: 'project',
              children: [
                {
                  id: 't1',
                  label: 'Adds',
                  kind: 'test',
                  location: { file: path.join(ROOT, 'A.cs'), line: 4 },
                },
                { id: 't2', label: 'Leaks', kind: 'test' },
              ],
            },
          ],
        },
      });
      expect(fake.requests).toEqual([{ op: 'discover', root: ROOT, params: {} }]);
    });

    it('discover_anAnswerThatIsNotATree_isRefused', async () => {
      const fake: FakeClient = fakeClient([]);
      fake.answer = (): TestAdapterResponse => ({
        id: 1,
        ok: true,
        result: { tests: 'all of them' } as never,
      });

      expect(await host(fake).host.discover('dotnet-tests', ROOT)).toMatchObject({
        ok: false,
        code: 'refused',
      });
    });

    it('discover_startsThePluginOnceForConcurrentFirstRequests', async () => {
      const fake: FakeClient = fakeClient([]);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: { tests: [] } });
      const { host: subject } = host(fake);

      await Promise.all([
        subject.discover('dotnet-tests', ROOT),
        subject.discover('dotnet-tests', ROOT),
      ]);

      expect(fake.starts.count).toBe(1);
    });
  });

  describe('runs', () => {
    it('planRun_sendsTheIdsAndAnOutputFolder_andAnswersTheCheckedCommand', async () => {
      const fake: FakeClient = fakeClient(['run', 'runSelected']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: COMMAND as never });
      const { host: subject } = host(fake);

      const answer: TestRunPlanAnswer = await subject.planRun('dotnet-tests', ROOT, ['a', 'b']);

      expect(answer).toMatchObject({
        ok: true,
        value: {
          command: { executable: 'dotnet', args: ['test'], cwd: ROOT, title: 'Test Shop.Tests' },
          selected: true,
        },
      });
      expect(fake.requests).toEqual([
        { op: 'run', root: ROOT, params: { ids: ['a', 'b'], outputDirectory: OUTPUT } },
      ]);
    });

    it('planRun_withoutRunSelected_sendsNoIdsAndSaysTheRunIsNotNarrowed', async () => {
      const fake: FakeClient = fakeClient(['run']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: COMMAND as never });

      const answer: TestRunPlanAnswer = await host(fake, {}, [
        descriptor({ capabilities: ['run'] }),
      ]).host.planRun('dotnet-tests', ROOT, ['a']);

      expect(answer).toMatchObject({ ok: true, value: { selected: false } });
      expect(fake.requests[0].params).toEqual({ ids: [], outputDirectory: OUTPUT });
    });

    it('planRun_whenTheManifestDeclaresRunButTheHandshakeDoesNot_isUnsupported', async () => {
      const fake: FakeClient = fakeClient([]);
      const { host: subject, folders } = host(fake);

      const answer: TestRunPlanAnswer = await subject.planRun('dotnet-tests', ROOT, []);

      expect(answer).toMatchObject({ ok: false, code: 'unsupported' });
      expect(fake.requests).toEqual([]);
      expect(folders.removed).toEqual(folders.made);
    });

    it.each<[string, Record<string, unknown>]>([
      ['runs outside the folder', { ...COMMAND, cwd: path.resolve('/elsewhere') }],
      ['has no executable', { ...COMMAND, executable: '' }],
      ['has an argument that is not text', { ...COMMAND, args: ['test', 7] }],
      ['sets a variable with a bad name', { ...COMMAND, env: { 'A=B': 'x' } }],
      ['sets a variable to something not text', { ...COMMAND, env: { A: 1 } }],
    ])(
      'planRun_refusesACommandThat %s_andRemovesItsFolder',
      async (_name: string, command: Record<string, unknown>) => {
        const fake: FakeClient = fakeClient(['run']);
        fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: command as never });
        const { host: subject, folders } = host(fake);

        expect(await subject.planRun('dotnet-tests', ROOT, [])).toMatchObject({
          ok: false,
          code: 'refused',
        });
        expect(folders.removed).toEqual([OUTPUT]);
      },
    );

    it.each<[string, unknown]>([
      ['not a list', 'all'],
      ['holding something that is not text', ['a', 3]],
      ['holding an empty identifier', ['']],
    ])('planRun_refusesIdsThatAre %s', async (_name: string, ids: unknown) => {
      const fake: FakeClient = fakeClient(['run']);

      expect(await host(fake).host.planRun('dotnet-tests', ROOT, ids)).toMatchObject({
        ok: false,
        code: 'refused',
      });
      expect(fake.requests).toEqual([]);
    });

    it('results_readsTheRunByItsIdentifier_withTheFolderTheHostMade_thenForgetsIt', async () => {
      const fake: FakeClient = fakeClient(['run', 'runSelected']);
      fake.answer = (op: TestAdapterOp): TestAdapterResponse =>
        op === 'run'
          ? { id: 1, ok: true, result: COMMAND as never }
          : {
              id: 2,
              ok: true,
              result: {
                results: [
                  {
                    id: 'a',
                    outcome: 'failed',
                    durationMs: 12,
                    message: 'boom',
                    stack: [
                      {
                        text: `at A in ${path.join(ROOT, 'A.cs')}:line 4`,
                        location: { file: path.join(ROOT, 'A.cs'), line: 4 },
                      },
                    ],
                  },
                  { id: 'b', outcome: 'exploded' as never },
                ],
              },
            };
      const { host: subject, folders } = host(fake);
      const plan: TestRunPlanAnswer = await subject.planRun('dotnet-tests', ROOT, ['a']);
      const runId: string = plan.ok ? plan.value.runId : '';

      const answer: TestResultsAnswer = await subject.results(runId, 1, '\x1b[31mFAIL\x1b[0m a');

      expect(answer).toEqual({
        ok: true,
        value: {
          results: [
            {
              id: 'a',
              outcome: 'failed',
              durationMs: 12,
              message: 'boom',
              stack: [
                {
                  text: `at A in ${path.join(ROOT, 'A.cs')}:line 4`,
                  location: { file: path.join(ROOT, 'A.cs'), line: 4 },
                },
              ],
            },
          ],
        },
      });
      expect(fake.requests[1]).toEqual({
        op: 'results',
        root: ROOT,
        params: { ids: ['a'], outputDirectory: OUTPUT, exitCode: 1, output: 'FAIL a' },
      });
      expect(folders.removed).toEqual([OUTPUT]);
      expect(await subject.results(runId, 1, '')).toMatchObject({ ok: false, code: 'refused' });
    });

    it('results_forARunTheHostNeverPlanned_isRefusedWithoutAskingThePlugin', async () => {
      const fake: FakeClient = fakeClient(['run']);

      expect(await host(fake).host.results('made-up', 0, '')).toMatchObject({
        ok: false,
        code: 'refused',
      });
      expect(fake.requests).toEqual([]);
    });

    it('finish_forgetsAPlannedRunAndRemovesItsFolder', async () => {
      const fake: FakeClient = fakeClient(['run']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: COMMAND as never });
      const { host: subject, folders } = host(fake);
      const plan: TestRunPlanAnswer = await subject.planRun('dotnet-tests', ROOT, []);
      const runId: string = plan.ok ? plan.value.runId : '';

      await subject.finish(runId);

      expect(folders.removed).toEqual([OUTPUT]);
      expect(await subject.results(runId, 0, '')).toMatchObject({ ok: false });
    });

    it('planRun_forgetsTheOldestWhenTooManyAwaitTheirResults', async () => {
      const fake: FakeClient = fakeClient(['run']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: COMMAND as never });
      const { host: subject, folders } = host(fake);

      for (let index: number = 0; index < 33; index += 1) {
        await subject.planRun('dotnet-tests', ROOT, []);
      }

      expect(folders.removed).toEqual([OUTPUT]);
    });
  });

  describe('debug', () => {
    const LAUNCH: Record<string, unknown> = {
      adapter: 'js-debug',
      title: 'Debug adds',
      program: path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
      args: ['run', 'a.test.ts'],
      cwd: ROOT,
      configuration: { smartStep: true },
    };

    it('planDebug_answersTheCheckedLaunch', async () => {
      const fake: FakeClient = fakeClient(['debug']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: LAUNCH as never });

      const answer: TestDebugPlanAnswer = await host(fake).host.planDebug(
        'dotnet-tests',
        ROOT,
        'a',
      );

      expect(answer).toMatchObject({ ok: true, value: { launch: LAUNCH } });
      expect(fake.requests[0].params).toEqual({ id: 'a', outputDirectory: OUTPUT });
    });

    it.each<[string, Record<string, unknown>]>([
      ['names an adapter that is not an identifier', { ...LAUNCH, adapter: '../netcoredbg' }],
      ['launches outside the folder', { ...LAUNCH, cwd: '/' }],
      ['shadows a key Studio writes', { ...LAUNCH, configuration: { program: '/bin/sh' } }],
      [
        'carries a configuration value that is not plain',
        { ...LAUNCH, configuration: { env: {} } },
      ],
      ['carries a prototype key', { ...LAUNCH, configuration: JSON.parse('{"__proto__": "x"}') }],
    ])(
      'planDebug_refusesALaunchThat %s',
      async (_name: string, launch: Record<string, unknown>) => {
        const fake: FakeClient = fakeClient(['debug']);
        fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: launch as never });
        const { host: subject, folders } = host(fake);

        expect(await subject.planDebug('dotnet-tests', ROOT, 'a')).toMatchObject({
          ok: false,
          code: 'refused',
        });
        expect(folders.removed).toEqual([OUTPUT]);
      },
    );

    it('planDebug_acceptsALaunchNamingAModuleRatherThanAProgram', async () => {
      const fake: FakeClient = fakeClient(['debug']);
      const launch: Record<string, unknown> = {
        adapter: 'debugpy',
        title: 'Debug test_adds',
        args: ['tests/test_math.py::test_adds'],
        cwd: ROOT,
        configuration: { module: 'pytest' },
      };
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: launch as never });

      expect(await host(fake).host.planDebug('dotnet-tests', ROOT, 'a')).toMatchObject({
        ok: true,
        value: { launch },
      });
    });

    it('planDebug_withoutTheCapability_isUnsupported', async () => {
      const fake: FakeClient = fakeClient(['run']);

      expect(await host(fake).host.planDebug('dotnet-tests', ROOT, 'a')).toMatchObject({
        ok: false,
        code: 'unsupported',
      });
    });
  });

  describe('lifecycle', () => {
    it('restartPlugin_stopsTheProcessSoTheNextRequestStartsItAfresh', async () => {
      const fake: FakeClient = fakeClient([]);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: { tests: [] } });
      const { host: subject } = host(fake);
      await subject.discover('dotnet-tests', ROOT);

      subject.restartPlugin('dotnet-tests');
      await subject.discover('dotnet-tests', ROOT);

      expect(fake.starts.count).toBe(2);
    });

    it('discover_afterThePluginWasUninstalled_stopsItsProcessAndSaysWhy', async () => {
      const fake: FakeClient = fakeClient([]);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: { tests: [] } });
      let installed: boolean = true;
      const { host: subject } = host(fake, {}, [
        descriptor({
          resolve: () =>
            installed
              ? { available: true, spec: { command: 'node', args: [] } }
              : { available: false, reason: '.NET Tests is not installed.' },
        }),
      ]);
      await subject.discover('dotnet-tests', ROOT);

      installed = false;
      const answer: TestDiscoverAnswer = await subject.discover('dotnet-tests', ROOT);

      expect(fake.disposed).toBe(true);
      expect(answer).toEqual({ ok: false, error: '.NET Tests is not installed.' });
    });

    it('dispose_removesEveryFolderStillHeld', async () => {
      const fake: FakeClient = fakeClient(['run']);
      fake.answer = (): TestAdapterResponse => ({ id: 1, ok: true, result: COMMAND as never });
      const { host: subject, folders } = host(fake);
      await subject.planRun('dotnet-tests', ROOT, []);

      subject.dispose();

      expect(folders.removed).toEqual([OUTPUT]);
      expect(fake.disposed).toBe(true);
    });
  });
});
