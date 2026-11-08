import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import type { TestDebugLaunch, TestNode } from '@shared/api/test-adapter-protocol';
import {
  TestAdapterInfo,
  TestChannel,
  TestHostAnswer,
  TestRunPlan,
} from '@shared/api/test-channels';
import { Log } from '@shared/angular/services/log/log';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TestAtLocation, TestRuns } from '@shared/angular/services/tests/test-runs';
import { DebugSession } from '@features/workspace/angular/debug/debug-session';
import { TestExplorer } from './test-explorer';
import { testKey, TestState } from './test-tree';

/**
 * The adapter every test works with.
 */
const ADAPTER: TestAdapterInfo = {
  pluginId: 'dotnet',
  displayName: '.NET Tests',
  frameworks: ['xUnit'],
  installed: true,
  capabilities: ['run', 'runSelected', 'debug'],
};

/**
 * The tree it discovers.
 */
const TREE: readonly TestNode[] = [
  {
    id: 'project',
    label: 'Shop.Tests',
    kind: 'project',
    children: [
      { id: 'Adds', label: 'Adds', kind: 'test', location: { file: '/repo/A.cs', line: 8 } },
      { id: 'Fails', label: 'Fails', kind: 'test', location: { file: '/repo/A.cs', line: 14 } },
      { id: 'Theory', label: 'Theory', kind: 'test', location: { file: '/repo/A.cs', line: 20 } },
    ],
  },
];

/**
 * Builds a key under {@link ADAPTER}.
 * @param id The node identifier.
 * @returns Returns the key.
 */
function key(id: string): string {
  return testKey('dotnet', id);
}

describe('TestExplorer (#1352)', () => {
  let explorer: TestExplorer;
  let invoke: ReturnType<typeof vi.fn>;
  let launches: { command: string; args: readonly string[]; reveal?: boolean }[];
  let exit: (code: number) => void;
  let debugState: WritableSignal<'idle' | 'running' | 'stopped'>;
  let launchTest: ReturnType<typeof vi.fn>;
  let adapters: readonly TestAdapterInfo[];
  let plan: TestHostAnswer<TestRunPlan>;
  let terminate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapters = [ADAPTER];
    plan = {
      ok: true,
      value: {
        runId: 'run-1',
        command: { executable: 'dotnet', args: ['test'], cwd: '/repo', title: 'Test Shop.Tests' },
        selected: true,
      },
    };
    invoke = vi.fn(<T>(channel: string): Promise<T> => {
      switch (channel as TestChannel) {
        case TestChannel.Adapters:
          return Promise.resolve(adapters as T);
        case TestChannel.Discover:
          return Promise.resolve({ ok: true, value: { tests: TREE } } as T);
        case TestChannel.PlanRun:
          return Promise.resolve(plan as T);
        case TestChannel.Results:
          return Promise.resolve({
            ok: true,
            value: {
              results: [
                { id: 'Adds', outcome: 'passed', durationMs: 4 },
                { id: 'Fails', outcome: 'failed', message: 'boom' },
                { id: 'Theory#1', outcome: 'passed', parentId: 'Theory', label: 'Theory(1)' },
              ],
            },
          } as T);
        case TestChannel.PlanDebug:
          return Promise.resolve({
            ok: true,
            value: {
              runId: 'debug-1',
              launch: {
                adapter: 'netcoredbg',
                title: 'Debug Adds',
                args: [],
                cwd: '/repo',
              } satisfies TestDebugLaunch,
            },
          } as T);
        default:
          return Promise.resolve(undefined as T);
      }
    });
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke,
      send: vi.fn(),
      on: vi.fn((): (() => void) => (): void => undefined),
    } as unknown as Bridge;
    launches = [];
    terminate = vi.fn((): void => exit(143));
    debugState = signal<'idle' | 'running' | 'stopped'>('idle');
    launchTest = vi.fn((): Promise<boolean> => {
      debugState.set('running');
      return Promise.resolve(true);
    });
    TestBed.configureTestingModule({
      providers: [
        TestExplorer,
        { provide: Workspace, useValue: { root: signal({ path: '/repo' }) } },
        {
          provide: TerminalSessions,
          useValue: {
            launch: (options: {
              command: string;
              args: readonly string[];
              reveal?: boolean;
            }): Promise<unknown> => {
              launches.push(options);
              return Promise.resolve({
                session: {},
                processId: 1,
                exited: new Promise<number>((resolve: (code: number) => void): void => {
                  exit = resolve;
                }),
              });
            },
            terminate,
            activateAndReveal: vi.fn(),
            sessions: signal([]),
          },
        },
        {
          provide: TerminalBridge,
          useValue: {
            replay: (): Promise<{ data: string }> => Promise.resolve({ data: 'transcript' }),
          },
        },
        { provide: DebugSession, useValue: { state: debugState, launchTest } },
        {
          provide: Log,
          useValue: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
      ],
    });
    explorer = TestBed.inject(TestExplorer);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Lets the explorer's first discovery land.
   */
  async function discovered(): Promise<void> {
    TestBed.tick();
    await vi.waitFor((): void => {
      expect(explorer.index().size).toBe(4);
    });
  }

  it('refresh_listsTheAdapters_andIndexesEachInstalledOnesTree', async () => {
    await discovered();

    expect(explorer.adapters()).toEqual([ADAPTER]);
    expect(invoke).toHaveBeenCalledWith(TestChannel.Discover, 'dotnet', '/repo');
    expect(explorer.phase()).toBe('idle');
  });

  it('refresh_doesNotAskAnAdapterThatIsNotInstalled', async () => {
    adapters = [{ ...ADAPTER, installed: false }];
    TestBed.tick();
    await vi.waitFor((): void => {
      expect(explorer.adapters().length).toBe(1);
    });

    expect(invoke).not.toHaveBeenCalledWith(
      TestChannel.Discover,
      expect.anything(),
      expect.anything(),
    );
    expect(explorer.installed()).toEqual([]);
  });

  it('run_plansRunsTheCommandInTheTestsTerminalWithoutRevealingIt_thenAppliesTheResults', async () => {
    await discovered();

    expect(await explorer.run([key('Adds'), key('Fails')])).toBe(true);
    await vi.waitFor((): void => {
      expect(launches.length).toBe(1);
    });
    expect(invoke).toHaveBeenCalledWith(TestChannel.PlanRun, 'dotnet', '/repo', ['Adds', 'Fails']);
    expect(launches[0]).toMatchObject({ command: 'dotnet', args: ['test'], reveal: false });
    expect([...explorer.running()]).toEqual([key('Adds'), key('Fails')]);
    expect(explorer.phase()).toBe('running');

    exit(1);
    await vi.waitFor((): void => {
      expect(explorer.phase()).toBe('idle');
    });

    expect(invoke).toHaveBeenCalledWith(TestChannel.Results, 'run-1', 1, 'transcript');
    const states: ReadonlyMap<string, TestState> = explorer.states();
    expect(states.get(key('Adds'))).toEqual({ outcome: 'passed', durationMs: 4 });
    expect(states.get(key('Fails'))).toEqual({ outcome: 'failed', message: 'boom' });
    // The theory's case only the run found joins the tree beneath its theory.
    expect(explorer.index().get(key('Theory#1'))?.parentKey).toBe(key('Theory'));
    expect(explorer.hasFailures()).toBe(true);
    expect(explorer.running().size).toBe(0);
  });

  it('run_whenTheAdapterCannotNarrowIt_marksEveryTestRunning', async () => {
    plan = { ok: true, value: { ...(plan as { value: TestRunPlan }).value, selected: false } };
    await discovered();

    await explorer.run([key('Adds')]);
    await vi.waitFor((): void => {
      expect(launches.length).toBe(1);
    });

    expect(explorer.running().size).toBe(3);
  });

  it('run_aRefusedPlan_saysWhyAndRunsNothing', async () => {
    plan = { ok: false, error: 'The folder is not trusted.', code: 'untrusted' };
    await discovered();

    await explorer.runAll();
    await vi.waitFor((): void => {
      expect(explorer.phase()).toBe('idle');
    });

    expect(launches).toEqual([]);
    expect(explorer.runProblem()).toBe('The folder is not trusted.');
  });

  it('runFailed_runsOnlyWhatFailed', async () => {
    await discovered();
    await explorer.runAll();
    await vi.waitFor((): void => {
      expect(launches.length).toBe(1);
    });
    exit(1);
    await vi.waitFor((): void => {
      expect(explorer.phase()).toBe('idle');
    });

    await explorer.runFailed();

    expect(invoke).toHaveBeenLastCalledWith(TestChannel.PlanRun, 'dotnet', '/repo', ['Fails']);
  });

  it('stop_interruptsTheTerminal_andStillReadsWhatItReported', async () => {
    await discovered();
    await explorer.runAll();
    await vi.waitFor((): void => {
      expect(launches.length).toBe(1);
    });

    explorer.stop();
    await vi.waitFor((): void => {
      expect(explorer.phase()).toBe('idle');
    });

    expect(terminate).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(TestChannel.Results, 'run-1', 143, 'transcript');
  });

  it('debug_launchesTheAdaptersLaunch_andFinishesItWhenTheSessionEnds', async () => {
    await discovered();

    expect(await explorer.debug(key('Adds'))).toBe(true);
    expect(launchTest).toHaveBeenCalledWith(expect.objectContaining({ adapter: 'netcoredbg' }));
    expect(explorer.phase()).toBe('debugging');

    debugState.set('idle');
    TestBed.tick();

    expect(invoke).toHaveBeenCalledWith(TestChannel.Finish, 'debug-1');
    expect(explorer.phase()).toBe('idle');
  });

  it('registersWithTheRunSeam_soALensCanRunTheTestOnItsLine', async () => {
    await discovered();
    const runs: TestRuns = TestBed.inject(TestRuns);

    const test: TestAtLocation | null = runs.testAt('/repo/A.cs', 14);

    expect(test).toEqual({
      pluginId: 'dotnet',
      id: 'Fails',
      label: 'Fails',
      kind: 'test',
      debuggable: true,
    });
    expect(await runs.run('/repo/A.cs', test!, 'run')).toBe(true);
    expect(invoke).toHaveBeenCalledWith(TestChannel.PlanRun, 'dotnet', '/repo', ['Fails']);
  });
});
